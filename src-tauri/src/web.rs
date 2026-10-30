use crate::{storage::Result, Backend};
use scraper::{Html, Selector};
use serde_json::{json, Value};
async fn text(mut response: reqwest::Response) -> Result<String> {
    if !response.status().is_success() {
        return Err(format!("Web request failed ({})", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Web request interrupted")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Web page exceeds the 2 MB reading limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
pub async fn read(backend: &Backend, address: &str) -> Result<String> {
    let url = url::Url::parse(address).map_err(|_| "Invalid URL")?;
    if url.scheme() != "https" {
        return Err("Web page must use HTTPS".into());
    }
    let html = text(
        backend
            .cloud
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| "Unable to reach web page")?,
    )
    .await?;
    let document = Html::parse_document(&html);
    let selector = Selector::parse("body").map_err(|e| e.to_string())?;
    let output = document
        .select(&selector)
        .flat_map(|element| element.text())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(output
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(24000)
        .collect())
}
pub async fn search(backend: &Backend, query: &str, count: usize) -> Result<Value> {
    let response = backend
        .cloud
        .http
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .send()
        .await
        .map_err(|_| "Web search unreachable")?;
    let html = text(response).await?;
    let mut results = Vec::new();
    {
        let document = Html::parse_document(&html);
        let rows = Selector::parse(".result").map_err(|e| e.to_string())?;
        let links = Selector::parse(".result__a").map_err(|e| e.to_string())?;
        let snippets = Selector::parse(".result__snippet").map_err(|e| e.to_string())?;
        for row in document.select(&rows).take(8) {
            let Some(link) = row.select(&links).next() else {
                continue;
            };
            let Some(href) = link.value().attr("href") else {
                continue;
            };
            let raw = if href.starts_with("//") {
                format!("https:{href}")
            } else {
                href.into()
            };
            let Ok(parsed) = url::Url::parse(&raw) else {
                continue;
            };
            let target = parsed
                .query_pairs()
                .find(|(key, _)| key == "uddg")
                .map(|(_, value)| value.to_string())
                .unwrap_or(raw);
            if !target.starts_with("https://") {
                continue;
            }
            results.push(json!({"title":link.text().collect::<Vec<_>>().join(" "),"url":target,"snippet":row.select(&snippets).next().map(|e|e.text().collect::<Vec<_>>().join(" ")).unwrap_or_default(),"content":""}));
        }
    }
    if results.is_empty() {
        let response = backend
            .cloud
            .http
            .get("https://en.wikipedia.org/w/api.php")
            .query(&[
                ("action", "query"),
                ("list", "search"),
                ("srsearch", query),
                ("format", "json"),
            ])
            .send()
            .await
            .map_err(|_| "Search fallback unreachable")?;
        let body: Value = response
            .json()
            .await
            .map_err(|_| "Invalid search response")?;
        if let Some(rows) = body["query"]["search"].as_array() {
            for row in rows.iter().take(6) {
                let title = row["title"].as_str().unwrap_or("");
                let url = format!(
                    "https://en.wikipedia.org/wiki/{}",
                    url::form_urlencoded::byte_serialize(title.replace(' ', "_").as_bytes())
                        .collect::<String>()
                );
                results
                    .push(json!({"title":title,"url":url,"snippet":row["snippet"],"content":""}));
            }
        }
    }
    for row in results.iter_mut().take(count.min(3)) {
        if let Some(url) = row["url"].as_str() {
            if let Ok(content) = read(backend, url).await {
                row["content"] = json!(content);
            }
        }
    }
    let context = results
        .iter()
        .enumerate()
        .map(|(i, row)| {
            format!(
                "[{}] {}\n{}\n{}\n{}",
                i + 1,
                row["title"].as_str().unwrap_or(""),
                row["url"].as_str().unwrap_or(""),
                row["snippet"].as_str().unwrap_or(""),
                row["content"].as_str().unwrap_or("")
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(json!({"query":query,"engine":"DuckDuckGo / Wikipedia","results":results,"context":context}))
}

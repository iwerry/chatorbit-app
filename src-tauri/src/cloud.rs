use crate::storage::{now, Result};
use serde_json::{json, Value};
use tokio::sync::Mutex;

const URL: &str = "https://jtdkbtszyrqogmvznrig.supabase.co";
const PUBLIC_KEY: &str = "sb_publishable_maAtOC_F27RQbWorjmbLdQ_dADUMJWK";
struct Session {
    access: String,
    expires: u64,
}
pub struct Cloud {
    pub http: reqwest::Client,
    session: Mutex<Option<Session>>,
}
impl Cloud {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(300))
                .build()
                .expect("HTTP client"),
            session: Mutex::new(None),
        }
    }
    fn credential() -> Result<keyring::Entry> {
        keyring::Entry::new("com.orbix.orbi", "supabase-refresh-token")
            .map_err(|_| "The operating system credential store is unavailable.".into())
    }
    fn refresh_token() -> Result<Option<String>> {
        match Self::credential()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(
                "Unable to read the saved sign-in from the operating system credential store."
                    .into(),
            ),
        }
    }
    async fn json_response(response: reqwest::Response) -> Result<Value> {
        let status = response.status();
        let body: Value = response
            .json()
            .await
            .map_err(|_| "The server returned an invalid response.")?;
        if !status.is_success() {
            return Err(body["error"]["message"]
                .as_str()
                .or(body["error_description"].as_str())
                .or(body["msg"].as_str())
                .or(body["message"].as_str())
                .unwrap_or("Orbi Cloud request failed.")
                .to_string());
        }
        Ok(body)
    }
    async fn auth(&self, path: &str, body: Value, token: Option<&str>, put: bool) -> Result<Value> {
        let request = if put {
            self.http.put(format!("{URL}/auth/v1{path}"))
        } else {
            self.http.post(format!("{URL}/auth/v1{path}"))
        };
        let mut request = request.header("apikey", PUBLIC_KEY).json(&body);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Unable to reach Supabase. Check your connection.")?;
        Self::json_response(response).await
    }
    async fn save_session(&self, session: &Value) -> Result<()> {
        let access = session["access_token"]
            .as_str()
            .ok_or("The server did not return a session.")?
            .to_string();
        let refresh = session["refresh_token"]
            .as_str()
            .ok_or("The server did not return a refresh token.")?;
        Self::credential()?
            .set_password(refresh)
            .map_err(|_| "Unable to save your sign-in securely. No plaintext token was written.")?;
        *self.session.lock().await = Some(Session {
            access,
            expires: now() + session["expires_in"].as_u64().unwrap_or(3600) * 1000,
        });
        Ok(())
    }
    pub async fn token(&self) -> Result<String> {
        let mut guard = self.session.lock().await;
        if let Some(session) = guard.as_ref() {
            if session.expires > now() + 60000 {
                return Ok(session.access.clone());
            }
        }
        let Some(refresh) = Self::refresh_token()? else {
            return Ok(String::new());
        };
        let result = self
            .auth(
                "/token?grant_type=refresh_token",
                json!({"refresh_token":refresh}),
                None,
                false,
            )
            .await?;
        let access = result["access_token"]
            .as_str()
            .ok_or("Invalid refreshed session.")?
            .to_string();
        let rotated = result["refresh_token"]
            .as_str()
            .ok_or("Invalid refresh token.")?;
        Self::credential()?
            .set_password(rotated)
            .map_err(|_| "Unable to save refreshed credentials securely.")?;
        *guard = Some(Session {
            access: access.clone(),
            expires: now() + result["expires_in"].as_u64().unwrap_or(3600) * 1000,
        });
        Ok(access)
    }
    pub async fn request(&self, path: &str, body: Option<Value>) -> Result<reqwest::Response> {
        // Paths are supplied only by native dispatch, never arbitrary frontend URLs.
        let token = self.token().await?;
        let url = format!("{URL}/functions/v1/orbi{path}");
        let mut request = if let Some(body) = body {
            self.http.post(url).json(&body)
        } else {
            self.http.get(url)
        };
        request = request.header("apikey", PUBLIC_KEY).header(
            "X-Orbi-Device",
            format!("Orbi native {}", env!("CARGO_PKG_VERSION")),
        );
        if !token.is_empty() {
            request = request.bearer_auth(token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Orbi Cloud is unreachable. Check your connection.")?;
        if !response.status().is_success() {
            return Err(Self::json_response(response)
                .await
                .err()
                .unwrap_or_else(|| "Orbi Cloud request failed.".into()));
        }
        Ok(response)
    }
    pub async fn call(&self, path: &str, body: Option<Value>) -> Result<Value> {
        Self::json_response(self.request(path, body).await?).await
    }
    pub async fn handle(&self, channel: &str, a: &Value) -> Option<Result<Value>> {
        if !channel.starts_with("cloud:") {
            return None;
        }
        Some(async {
            match channel {
                "cloud:login"=>{let session=self.auth("/token?grant_type=password",a.clone(),None,false).await?; self.save_session(&session).await?; Ok(json!(true))},
                "cloud:signup"=>{
                    let session=self.auth("/signup",json!({"email":a["email"],"password":a["password"],"data":{"name":a["name"]}}),None,false).await?;
                    let confirm=session["access_token"].as_str().is_none();
                    if !confirm {self.save_session(&session).await?;}
                    Ok(json!({"confirm":confirm,"email":a["email"]}))
                },
                "cloud:confirmSignup" | "cloud:resetPassword"=>{
                    let recovery=channel=="cloud:resetPassword";
                    let session=self.auth("/verify",json!({"type":if recovery {"recovery"} else {"signup"},"email":a["email"],"token":a["code"]}),None,false).await?;
                    self.save_session(&session).await?;
                    if recovery {self.auth("/user",json!({"password":a["password"]}),session["access_token"].as_str(),true).await?;}
                    Ok(json!(true))
                },
                "cloud:logout"=>{
                    let token=self.token().await.unwrap_or_default();
                    match Self::credential()?.delete_credential() {Ok(())|Err(keyring::Error::NoEntry)=>(),Err(_)=>return Err("Unable to remove the saved sign-in securely.".into())}
                    *self.session.lock().await=None;
                    if !token.is_empty() {let _=self.auth("/logout",json!({}),Some(&token),false).await;}
                    Ok(json!(true))
                },
                "cloud:recover"=>self.auth("/recover",json!({"email":a}),None,false).await,
                "cloud:resend"=>self.auth("/resend",json!({"type":"signup","email":a}),None,false).await,
                "cloud:catalog"=>self.call("/v1/catalog",None).await,
                "cloud:plans"=>self.call("/billing/plans",None).await,
                "cloud:usage"=>self.call("/me/usage",None).await,
                "cloud:stats"=>self.call("/admin/stats",None).await,
                "cloud:grant"=>self.call("/admin/grant",Some(a.clone())).await,
                "cloud:checkout"=>self.call("/billing/checkout",Some(json!({"item":a}))).await,
                "cloud:portal"=>self.call("/billing/portal",Some(json!({}))).await,
                "cloud:state"=>{
                    let signed_in=Self::refresh_token()?.is_some();
                    let result=self.call(if signed_in {"/me"} else {"/health"},None).await;
                    Ok(match result {Ok(body)=>json!({"url":URL,"signedIn":signed_in,"online":true,"configured":body["openrouter"].as_bool().unwrap_or(signed_in),"user":body["user"],"payments":body["payments"].as_bool().unwrap_or(false),"error":null,"code":null}), Err(error)=>json!({"url":URL,"signedIn":signed_in,"online":false,"user":null,"payments":false,"error":error,"code":"offline"})})
                },
                _=>Err(format!("Cloud native migration incomplete: {channel}")),
            }
        }.await)
    }
}

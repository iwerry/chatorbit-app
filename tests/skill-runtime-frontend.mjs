import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGoalCommand, skillRuntimeInstructions } from '../src/lib/skillRuntime.ts'

test('goal can precede or follow the skill command without changing ordinary text', () => {
  assert.deepEqual(parseGoalCommand('/informative-video-remotion /goal Criar vídeo'), { goal: true, text: '/informative-video-remotion Criar vídeo' })
  assert.deepEqual(parseGoalCommand('/goal /informative-video-remotion Criar vídeo'), { goal: true, text: '/informative-video-remotion Criar vídeo' })
  assert.deepEqual(parseGoalCommand('Explique /goal sem executar'), { goal: false, text: 'Explique /goal sem executar' })
  assert.deepEqual(parseGoalCommand('/goalkeeper exemplo'), { goal: false, text: '/goalkeeper exemplo' })
  assert.match(skillRuntimeInstructions(true), /GOAL MODE/)
})

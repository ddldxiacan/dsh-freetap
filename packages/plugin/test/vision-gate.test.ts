/**
 * Regression: image input must not depend on models.dev being warm.
 *
 * `inputModalities` is not a cosmetic label. dsh-llm reads it at the adapter
 * boundary and, when the list lacks `image`, projects every image block to a
 * "[image omitted]" text placeholder BEFORE the adapter is called
 * (projectImagesForTextModel). The fallback in isVisionModel therefore decides
 * whether a vision-capable model can see a picture at all while metadata is
 * still pending — a cold boot, a slow feed, or a first install with no cache.
 *
 * It used to cover only the mimo-v2.6 family, so on a cold catalog
 * deepseek-v4.1-flash-free was advertised text-only and answered "I can't see
 * the image" while the same request with warm metadata described the
 * screenshot correctly (live-verified 2026-10-20).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { isVisionModel } from '../src/adapter/zen-adapter.ts'

test('vision families stay image-capable while metadata is pending', () => {
  // Verified on the live lane 2026-10-20 (metadata warm AND cold).
  for (const id of [
    'deepseek-v4.1-flash-free',
    'deepseek-v4.1-flash',
    'mimo-v2.6-flash-free',
    'nemotron-3.5-super-vl-free',
    'longcat-2.5-preview-free',
    'glm-5.3-flash-free',
  ]) {
    assert.equal(isVisionModel(id, undefined), true, `${id} must accept images without metadata`)
  }
})

test('genuinely text-only models are still refused without metadata', () => {
  for (const id of ['big-pickle', 'beam-free', 'nemotron-3.5-lightning-free', 'immune-free']) {
    assert.equal(isVisionModel(id, undefined), false, `${id} must stay text-only`)
  }
})

test('a declared verdict from models.dev always wins over the pattern', () => {
  // Upstream is the authority in both directions: a declared text-only model is
  // refused even though the family pattern matches, and a declared image model
  // is accepted even though no pattern matches.
  assert.equal(isVisionModel('deepseek-v4.1-flash-free', ['text']), false)
  assert.equal(isVisionModel('big-pickle', ['text', 'image']), true)
  assert.equal(isVisionModel('some-new-free', ['text', 'image']), true)
})

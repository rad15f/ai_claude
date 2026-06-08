// Popup dashboard logic

import type { ExtensionMessage, StoredSettings, VideoStats } from './types.js'

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const apiKeyInput = document.getElementById('api-key') as HTMLInputElement
const saveKeyBtn = document.getElementById('save-key') as HTMLButtonElement
const thresholdSlider = document.getElementById('threshold') as HTMLInputElement
const thresholdLabel = document.getElementById('threshold-label') as HTMLSpanElement
const hideToggle = document.getElementById('hide-toggle') as HTMLInputElement
const totalScannedEl = document.getElementById('total-scanned') as HTMLSpanElement
const flaggedCountEl = document.getElementById('flagged-count') as HTMLSpanElement
const topSignalsEl = document.getElementById('top-signals') as HTMLUListElement

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const result = await chrome.storage.local.get('settings')
  const settings = (result['settings'] as StoredSettings | undefined) ?? {
    sensitivityThreshold: 60,
    hideAboveThreshold: false,
    serverSyncEnabled: false,
  }

  if (settings.apiKey) apiKeyInput.value = settings.apiKey
  thresholdSlider.value = String(settings.sensitivityThreshold)
  thresholdLabel.textContent = `${settings.sensitivityThreshold}%`
  hideToggle.checked = settings.hideAboveThreshold

  await loadVideoStats()
}

async function loadVideoStats(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return

  const msg: ExtensionMessage = {
    type: 'GET_VIDEO_STATS',
    videoId: new URLSearchParams(new URL(tab.url ?? '').search).get('v') ?? '',
  }

  chrome.tabs.sendMessage(tab.id, msg, (response: ExtensionMessage | undefined) => {
    if (!response || response.type !== 'VIDEO_STATS_RESULT') return
    renderStats(response.stats)
  })
}

function renderStats(stats: VideoStats): void {
  totalScannedEl.textContent = String(stats.totalScanned)
  flaggedCountEl.textContent = String(stats.flaggedCount)

  topSignalsEl.innerHTML = ''
  const sorted = Object.entries(stats.signalFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  for (const [signal, count] of sorted) {
    const li = document.createElement('li')
    li.textContent = `${signal}: ${count}`
    topSignalsEl.appendChild(li)
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

saveKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim()
  if (!apiKey) return

  const msg: ExtensionMessage = { type: 'SET_API_KEY', apiKey }
  await chrome.runtime.sendMessage(msg)
  saveKeyBtn.textContent = 'Saved!'
  setTimeout(() => { saveKeyBtn.textContent = 'Save' }, 1500)
})

thresholdSlider.addEventListener('input', async () => {
  const value = parseInt(thresholdSlider.value, 10)
  thresholdLabel.textContent = `${value}%`

  const result = await chrome.storage.local.get('settings')
  const settings = (result['settings'] as StoredSettings | undefined) ?? {
    sensitivityThreshold: 60,
    hideAboveThreshold: false,
    serverSyncEnabled: false,
  }
  await chrome.storage.local.set({
    settings: { ...settings, sensitivityThreshold: value },
  })
})

hideToggle.addEventListener('change', async () => {
  const result = await chrome.storage.local.get('settings')
  const settings = (result['settings'] as StoredSettings | undefined) ?? {
    sensitivityThreshold: 60,
    hideAboveThreshold: false,
    serverSyncEnabled: false,
  }
  await chrome.storage.local.set({
    settings: { ...settings, hideAboveThreshold: hideToggle.checked },
  })
})

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init)

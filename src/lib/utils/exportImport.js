// Utility functions for exporting and importing chat data

import { getChats, getChat, createChat, saveChatContent } from '../chatsStore.js'
import { loadSettings, saveSettings } from '../settingsStore.js'
import { getAllImages, storeImage } from '../imageStore.js'

/**
 * Export a single chat as JSON
 */
export async function exportChat(chatId) {
  try {
    const chat = await getChat(chatId)
    if (!chat) {
      throw new Error('Chat not found')
    }

    const exportData = {
      version: 1,
      type: 'single_chat',
      exportedAt: new Date().toISOString(),
      chat
    }

    const jsonStr = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const fileName = `chat_${sanitizeFilename(chat.title || 'untitled')}_${Date.now()}.json`
    downloadFile(url, fileName)

    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Failed to export chat:', err)
    throw err
  }
}

/**
 * Import a single chat from JSON file
 */
export async function importChat(file) {
  try {
    const text = await file.text()
    const data = JSON.parse(text)

    if (data.type !== 'single_chat' || !data.chat) {
      throw new Error('Invalid chat export file')
    }

    const chat = data.chat

    // Create a new chat with the imported data
    const result = await createChat({
      nodes: chat.nodes,
      rootId: chat.rootId,
      settings: chat.settings,
      presetId: chat.presetId
    })

    return result
  } catch (err) {
    console.error('Failed to import chat:', err)
    throw err
  }
}

/**
 * Export all data (chats, settings, images) as a ZIP file
 */
export async function exportAllData() {
  try {
    // We'll use JSZip for creating the zip file
    // First check if JSZip is available
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded')
    }

    const zip = new JSZip()

    // Export all chats
    const chats = await getChats()
    const chatsData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      chats
    }
    zip.file('chats.json', JSON.stringify(chatsData, null, 2))

    // Export settings
    const settings = loadSettings()
    const settingsData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings
    }
    zip.file('settings.json', JSON.stringify(settingsData, null, 2))

    // Export images if indexedDB is available
    try {
      const images = await getAllImages()
      if (images && images.length > 0) {
        const imagesFolder = zip.folder('images')
        const imagesManifest = []

        for (const image of images) {
          if (image.data && image.id) {
            // Store base64 data in separate files to keep JSON readable
            const ext = getExtensionFromMimeType(image.mimeType) || 'dat'
            const filename = `${image.id}.${ext}`
            imagesFolder.file(filename, image.data.split(',')[1] || image.data, { base64: true })

            imagesManifest.push({
              id: image.id,
              filename,
              mimeType: image.mimeType,
              name: image.name
            })
          }
        }

        zip.file('images/manifest.json', JSON.stringify({ version: 1, images: imagesManifest }, null, 2))
      }
    } catch (err) {
      console.warn('Failed to export images:', err)
    }

    // Generate the zip file
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)

    const fileName = `advui_backup_${Date.now()}.zip`
    downloadFile(url, fileName)

    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Failed to export all data:', err)
    throw err
  }
}

/**
 * Import all data from a ZIP file
 */
export async function importAllData(file) {
  try {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded')
    }

    const zip = new JSZip()
    const contents = await zip.loadAsync(file)

    const results = {
      chatsImported: 0,
      settingsImported: false,
      imagesImported: 0,
      errors: []
    }

    // Import settings first
    try {
      const settingsFile = contents.file('settings.json')
      if (settingsFile) {
        const settingsText = await settingsFile.async('text')
        const settingsData = JSON.parse(settingsText)
        if (settingsData.settings) {
          // Merge with existing settings cautiously
          const currentSettings = loadSettings()
          const merged = {
            ...settingsData.settings,
            // Preserve current selected IDs
            selectedConnectionId: currentSettings.selectedConnectionId || settingsData.settings.selectedConnectionId,
            selectedPresetId: currentSettings.selectedPresetId || settingsData.settings.selectedPresetId
          }
          saveSettings(merged)
          results.settingsImported = true
        }
      }
    } catch (err) {
      console.error('Failed to import settings:', err)
      results.errors.push(`Settings: ${err.message}`)
    }

    // Import images
    try {
      const manifestFile = contents.file('images/manifest.json')
      if (manifestFile) {
        const manifestText = await manifestFile.async('text')
        const manifestData = JSON.parse(manifestText)

        if (manifestData.images && Array.isArray(manifestData.images)) {
          for (const imageInfo of manifestData.images) {
            try {
              const imageFile = contents.file(`images/${imageInfo.filename}`)
              if (imageFile) {
                const base64Data = await imageFile.async('base64')
                const dataUrl = `data:${imageInfo.mimeType || 'image/png'};base64,${base64Data}`
                await storeImage(imageInfo.id, dataUrl, imageInfo.mimeType, imageInfo.name)
                results.imagesImported++
              }
            } catch (err) {
              console.error(`Failed to import image ${imageInfo.id}:`, err)
              results.errors.push(`Image ${imageInfo.id}: ${err.message}`)
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to import images:', err)
      results.errors.push(`Images: ${err.message}`)
    }

    // Import chats
    try {
      const chatsFile = contents.file('chats.json')
      if (chatsFile) {
        const chatsText = await chatsFile.async('text')
        const chatsData = JSON.parse(chatsText)

        if (chatsData.chats && Array.isArray(chatsData.chats)) {
          for (const chat of chatsData.chats) {
            try {
              await createChat({
                nodes: chat.nodes,
                rootId: chat.rootId,
                settings: chat.settings,
                presetId: chat.presetId
              })
              results.chatsImported++
            } catch (err) {
              console.error(`Failed to import chat ${chat.id}:`, err)
              results.errors.push(`Chat "${chat.title || 'untitled'}": ${err.message}`)
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to import chats:', err)
      results.errors.push(`Chats: ${err.message}`)
    }

    return results
  } catch (err) {
    console.error('Failed to import all data:', err)
    throw err
  }
}

/**
 * Helper: Download a file with a given URL and filename
 */
function downloadFile(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

/**
 * Helper: Sanitize a string for use in filenames
 */
function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9_\-]/gi, '_')
    .replace(/_+/g, '_')
    .substring(0, 50)
}

/**
 * Helper: Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType) {
  if (!mimeType) return 'dat'
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg'
  }
  return map[mimeType.toLowerCase()] || 'dat'
}

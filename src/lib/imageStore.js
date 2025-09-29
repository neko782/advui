// IndexedDB storage for images
// Stores base64 encoded images with unique IDs

const DB_NAME = 'advui_images'
const DB_VERSION = 1
const STORE_NAME = 'images'

let dbInstance = null

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
  })
}

export async function storeImage(id, base64Data, mimeType) {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    const image = {
      id,
      data: base64Data,
      mimeType,
      timestamp: Date.now()
    }

    await new Promise((resolve, reject) => {
      const request = store.put(image)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    return id
  } catch (err) {
    console.error('Failed to store image:', err)
    throw err
  }
}

export async function getImage(id) {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readonly')
    const store = transaction.objectStore(STORE_NAME)

    return await new Promise((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to get image:', err)
    return null
  }
}

export async function deleteImage(id) {
  try {
    const db = await openDB()
    const transaction = db.transaction([STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)

    await new Promise((resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.error('Failed to delete image:', err)
  }
}

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      // Remove the data URL prefix to get just the base64 data
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function generateImageId() {
  return `img_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}
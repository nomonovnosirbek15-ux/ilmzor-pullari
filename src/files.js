import { Linking, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File as FSFile } from 'expo-file-system';
import { supabase } from './supabase';

const extOf = (name = '', mime = '') => {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('png')) return 'png';
  return 'jpg';
};

export const kindOf = (asset) => ((asset.mimeType || '').includes('pdf') || /\.pdf$/i.test(asset.name || '') ? 'pdf' : 'image');

// PDF yoki rasm tanlash (o'qituvchi uchun)
export async function pickDocument() {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  return r.assets[0];
}

// Rasm: kamera yoki galereya (o'quvchi uchun)
export async function pickPhoto(fromCamera) {
  const opts = { mediaTypes: ['images'], quality: 0.6 };
  if (fromCamera && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Kameraga ruxsat berilmadi");
    const r = await ImagePicker.launchCameraAsync(opts);
    return r.canceled ? null : r.assets[0];
  }
  const r = await ImagePicker.launchImageLibraryAsync(opts);
  return r.canceled ? null : r.assets[0];
}

async function bodyOf(asset) {
  if (Platform.OS === 'web') {
    if (asset.file) return asset.file;
    return (await fetch(asset.uri)).blob();
  }
  return new FSFile(asset.uri).arrayBuffer();
}

export async function uploadAsset(bucket, folder, asset) {
  if (asset.size && asset.size > 20 * 1024 * 1024) throw new Error('Fayl juda katta (20 MB dan oshmasin)');
  const ext = extOf(asset.name || asset.fileName, asset.mimeType);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const contentType = asset.mimeType || (ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg');
  const { error } = await supabase.storage.from(bucket).upload(path, await bodyOf(asset), { contentType, upsert: false });
  if (error) throw new Error('Fayl yuklanmadi: ' + error.message);
  return path;
}

export async function signedUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw new Error('Faylni ochib bo\'lmadi');
  return data.signedUrl;
}

export async function openFile(bucket, path) {
  const url = await signedUrl(bucket, path);
  if (Platform.OS === 'web') window.open(url, '_blank');
  else await Linking.openURL(url);
}

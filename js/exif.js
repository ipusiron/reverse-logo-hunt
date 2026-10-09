// 画像の EXIF から撮影地点（GPS）を読む。ExifReader（CDN）を使い、値の読み取りは exif-core.js
import { gpsFromTags } from "./exif-core.js";

export async function readExifGps(arrayBuffer) {
  if (typeof ExifReader === "undefined") return null;
  const tags = await ExifReader.load(arrayBuffer, { expanded: true });
  return gpsFromTags(tags);
}

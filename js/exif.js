export async function readExifGps(arrayBuffer){
  const tags = await ExifReader.load(arrayBuffer, {expanded:true});
  const latRef = tags.gps?.LatitudeRef?.description || tags.gps?.LatitudeRef?.value;
  const lonRef = tags.gps?.LongitudeRef?.description || tags.gps?.LongitudeRef?.value;
  const lat = tags.gps?.Latitude?.description || tags.gps?.Latitude?.value;
  const lon = tags.gps?.Longitude?.description || tags.gps?.Longitude?.value;
  if(!lat || !lon) return null;

  const latVal = toDecimal(lat, latRef);
  const lonVal = toDecimal(lon, lonRef);
  if(Number.isFinite(latVal) && Number.isFinite(lonVal)){
    return { lat: latVal, lng: lonVal };
  }
  return null;
}
function toDecimal(val, ref){
  // val may be "35° 39' 12.34\"" or array of rationals
  let deg=0, min=0, sec=0;
  if(Array.isArray(val) && val.length>=3){
    deg = ratToFloat(val[0]); min = ratToFloat(val[1]); sec = ratToFloat(val[2]);
  }else if(typeof val === 'string'){
    const m = val.match(/([\d\.]+)[^\d]+([\d\.]+)[^\d]+([\d\.]+)/);
    if(m){ deg=parseFloat(m[1]); min=parseFloat(m[2]); sec=parseFloat(m[3]); }
  }
  let d = deg + (min/60) + (sec/3600);
  if(ref==='S' || ref==='W') d = -d;
  return d;
}
function ratToFloat(r){
  if(typeof r === 'number') return r;
  if(r.numerator!=null && r.denominator!=null) return r.numerator / (r.denominator||1);
  return parseFloat(r)||0;
}

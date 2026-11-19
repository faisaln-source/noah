export function formatFileSize(size?:number){
  if(size===undefined || !Number.isFinite(size) || size<0)return 'Not available';
  const units=['bytes','KB','MB','GB','TB'];
  let value=size,index=0;
  while(value>=1000 && index<units.length-1){value/=1000;index++;}
  return `${index?value.toFixed(2):value.toFixed(0)} ${units[index]}`;
}
export default function FileSize({size}:{size?:number}){
  return <span className="file-size" title={size===undefined?undefined:`${size.toLocaleString()} bytes`} aria-label={`File size: ${formatFileSize(size)}`}>File size: {formatFileSize(size)}</span>;
}

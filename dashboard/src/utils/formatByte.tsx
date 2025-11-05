export function formatBytes(bytes: number, decimals?: number): string;
export function formatBytes(bytes: number, decimals: number | undefined, asArray: true): [number, string];
export function formatBytes(bytes: number, decimals = 2, asArray = false): string | [number, string] {
  if (!+bytes) {
    const zeroResult: [number, string] = [0, "B"];
    return asArray ? zeroResult : `${zeroResult[0]} ${zeroResult[1]}`;
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
  if (!asArray) {
    return `${value} ${sizes[i]}`;
  }
  return [value, sizes[i]];
}

export const numberWithCommas = (x: number) => {
  if (x !== null) return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

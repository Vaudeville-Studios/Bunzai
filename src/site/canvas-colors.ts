/** Resolve computed CSS colors to normalized RGB byte values for WebGL uniforms. */
export function sampleCssColor(context: CanvasRenderingContext2D, cssColor: string): [number, number, number] {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return [pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255];
}

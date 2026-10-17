/** Wind blowing toward (dx, dy), a unit vector; W→E is { dx: 1, dy: 0 }. */
export interface Wind {
  dx: number;
  dy: number;
  speedKmh: number;
}

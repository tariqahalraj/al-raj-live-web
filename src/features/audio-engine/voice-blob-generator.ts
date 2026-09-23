/**
 * VoiceBlobGenerator
 *
 * Implements procedural harmonic noise and Catmull-Rom closed cubic Bézier
 * spline generation for the Telegram-style audio-reactive voice blob.
 *
 * Pre-allocates coordinate buffers and trigonometric lookup tables to guarantee
 * 60 FPS performance with zero garbage-collection overhead.
 */

export const BLOB_POINT_COUNT = 36;
export const BLOB_VIEWBOX_SIZE = 200;
export const BLOB_CENTER = 100;

// Precomputed trigonometric lookup tables for BLOB_POINT_COUNT points
const ANGLES = new Float32Array(BLOB_POINT_COUNT);
const COS_TABLE = new Float32Array(BLOB_POINT_COUNT);
const SIN_TABLE = new Float32Array(BLOB_POINT_COUNT);

for (let i = 0; i < BLOB_POINT_COUNT; i++) {
  const theta = (i * 2 * Math.PI) / BLOB_POINT_COUNT;
  ANGLES[i] = theta;
  COS_TABLE[i] = Math.cos(theta);
  SIN_TABLE[i] = Math.sin(theta);
}

export interface BlobLayerState {
  pathData: string;
  opacity: number;
}

export class VoiceBlobGenerator {
  // Pre-allocated coordinate buffers for 3 layers
  private layerPointsX: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(BLOB_POINT_COUNT),
    new Float32Array(BLOB_POINT_COUNT),
    new Float32Array(BLOB_POINT_COUNT),
  ];
  private layerPointsY: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(BLOB_POINT_COUNT),
    new Float32Array(BLOB_POINT_COUNT),
    new Float32Array(BLOB_POINT_COUNT),
  ];

  /**
   * Computes the SVG path string for a closed Catmull-Rom spline
   * smoothly connecting all points around the circumference.
   */
  private buildClosedSplinePath(
    pointsX: Float32Array,
    pointsY: Float32Array
  ): string {
    const n = BLOB_POINT_COUNT;
    let d = `M ${pointsX[0].toFixed(1)},${pointsY[0].toFixed(1)} `;

    for (let i = 0; i < n; i++) {
      const pPrev = i === 0 ? n - 1 : i - 1;
      const pCurr = i;
      const pNext = (i + 1) % n;
      const pAfter = (i + 2) % n;

      // Catmull-Rom control points (tension = 1/6)
      const cp1x = pointsX[pCurr] + (pointsX[pNext] - pointsX[pPrev]) / 6;
      const cp1y = pointsY[pCurr] + (pointsY[pNext] - pointsY[pPrev]) / 6;

      const cp2x = pointsX[pNext] - (pointsX[pAfter] - pointsX[pCurr]) / 6;
      const cp2y = pointsY[pNext] - (pointsY[pAfter] - pointsY[pCurr]) / 6;

      d += `C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${pointsX[pNext].toFixed(1)},${pointsY[pNext].toFixed(1)} `;
    }

    d += 'Z';
    return d;
  }

  /**
   * Generates all 3 layered organic shapes for the current animation frame.
   *
   * @param audioLevel Smoothed normalized speech amplitude in [0.0, 1.0]
   * @param timeSeconds Continuous monotonic time in seconds
   * @param isMuted Whether microphone is muted
   * @param prefersReducedMotion Whether user prefers reduced motion
   * @returns Array of 3 BlobLayerState objects containing SVG path data and opacity
   */
  generateLayers(
    audioLevel: number,
    timeSeconds: number,
    isMuted: boolean,
    prefersReducedMotion: boolean
  ): [BlobLayerState, BlobLayerState, BlobLayerState] {
    const cx = BLOB_CENTER;
    const cy = BLOB_CENTER;
    const t = timeSeconds;

    if (isMuted) {
      // Muted: all outer layers hidden, return idle circles
      return [
        { pathData: this.buildCirclePath(48), opacity: 0 },
        { pathData: this.buildCirclePath(48), opacity: 0 },
        { pathData: this.buildCirclePath(48), opacity: 0 },
      ];
    }

    // ================= LAYER 1: MAIN INNER BLOB =================
    // Closest to the 48px microphone button.
    // Resting: subtle breathing contour. Speaking: strong fluid lobes.
    const l1X = this.layerPointsX[0];
    const l1Y = this.layerPointsY[0];
    const l1Base = 49.0;

    for (let i = 0; i < BLOB_POINT_COUNT; i++) {
      const theta = ANGLES[i];
      let r = l1Base;

      if (!prefersReducedMotion) {
        // Multi-harmonic fluid deformation waves
        const h1 =
          0.50 * Math.sin(2 * theta + t * 2.2) +
          0.35 * Math.sin(3 * theta - t * 1.6 + 0.7) +
          0.15 * Math.cos(4 * theta + t * 2.8);

        // Directional asymmetry (spatial weighting)
        const spatial1 = 1.0 + 0.18 * Math.sin(2 * theta + 0.4);

        const idle =
          1.5 * (Math.sin(2 * theta + t * 0.9) * 0.6 + Math.cos(3 * theta - t * 0.7) * 0.4);
        const expand = audioLevel * (20.0 + 4.0 * Math.sin(2 * theta + t * 1.1));
        const deform = audioLevel * 14.0 * h1 * spatial1;

        r += idle + expand + deform;
      } else {
        r += audioLevel * 18.0;
      }

      l1X[i] = cx + r * COS_TABLE[i];
      l1Y[i] = cy + r * SIN_TABLE[i];
    }

    const l1Opacity = 0.55 + audioLevel * 0.35;

    // ================= LAYER 2: MIDDLE BLOB =================
    // Asymmetric phase (+1.85 rad), different harmonic speeds.
    // Softly emerges when speaking starts.
    const l2X = this.layerPointsX[1];
    const l2Y = this.layerPointsY[1];
    const l2Base = 48.0;
    let l2Opacity = 0;

    if (audioLevel > 0.04) {
      const t2 = Math.min(1, (audioLevel - 0.04) / 0.96);
      l2Opacity = t2 * 0.55;

      for (let i = 0; i < BLOB_POINT_COUNT; i++) {
        const theta = ANGLES[i];
        let r = l2Base;

        if (!prefersReducedMotion) {
          const h2 =
            0.45 * Math.sin(2 * theta + t * 1.7 + 1.85) +
            0.35 * Math.cos(3 * theta - t * 2.3 + 1.2) +
            0.20 * Math.sin(5 * theta + t * 1.5);

          const spatial2 = 1.0 + 0.22 * Math.cos(2 * theta + 1.8);
          const expand = audioLevel * (26.0 + 5.0 * Math.cos(3 * theta - t * 1.3));
          const deform = audioLevel * 18.0 * h2 * spatial2;

          r += expand + deform;
        } else {
          r += audioLevel * 24.0;
        }

        l2X[i] = cx + r * COS_TABLE[i];
        l2Y[i] = cy + r * SIN_TABLE[i];
      }
    } else {
      // Resting position under Layer 1
      for (let i = 0; i < BLOB_POINT_COUNT; i++) {
        l2X[i] = cx + 48 * COS_TABLE[i];
        l2Y[i] = cy + 48 * SIN_TABLE[i];
      }
    }

    // ================= LAYER 3: OUTER AURA BLOB =================
    // Outermost translucent aura, activates on stronger speech (> 0.22)
    const l3X = this.layerPointsX[2];
    const l3Y = this.layerPointsY[2];
    const l3Base = 47.0;
    let l3Opacity = 0;

    if (audioLevel > 0.22) {
      const t3 = Math.min(1, (audioLevel - 0.22) / 0.78);
      l3Opacity = t3 * 0.28;

      for (let i = 0; i < BLOB_POINT_COUNT; i++) {
        const theta = ANGLES[i];
        let r = l3Base;

        if (!prefersReducedMotion) {
          const h3 =
            0.40 * Math.cos(2 * theta - t * 1.4 + 3.7) +
            0.40 * Math.sin(3 * theta + t * 1.9 + 2.4) +
            0.20 * Math.cos(4 * theta - t * 2.5);

          const expand = audioLevel * (33.0 + 6.0 * Math.sin(3 * theta + t * 1.5));
          const deform = audioLevel * 22.0 * h3;

          r += expand + deform;
        } else {
          r += audioLevel * 30.0;
        }

        l3X[i] = cx + r * COS_TABLE[i];
        l3Y[i] = cy + r * SIN_TABLE[i];
      }
    } else {
      // Resting position under Layer 1
      for (let i = 0; i < BLOB_POINT_COUNT; i++) {
        l3X[i] = cx + 47 * COS_TABLE[i];
        l3Y[i] = cy + 47 * SIN_TABLE[i];
      }
    }

    return [
      {
        pathData: this.buildClosedSplinePath(l1X, l1Y),
        opacity: l1Opacity,
      },
      {
        pathData: this.buildClosedSplinePath(l2X, l2Y),
        opacity: l2Opacity,
      },
      {
        pathData: this.buildClosedSplinePath(l3X, l3Y),
        opacity: l3Opacity,
      },
    ];
  }

  private buildCirclePath(radius: number): string {
    const cx = BLOB_CENTER;
    const cy = BLOB_CENTER;
    return `M ${cx - radius},${cy} a ${radius},${radius} 0 1,0 ${radius * 2},0 a ${radius},${radius} 0 1,0 -${radius * 2},0 Z`;
  }
}

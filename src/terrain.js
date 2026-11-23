import { DoubleSide, Mesh, Vector3, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, MeshLambertMaterial, CanvasTexture, Sprite, SpriteMaterial, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// The 3D visualizer: the 2D spectrum bars, with the song so far lined up behind them. The track is divided into slices
// (rows); the live row at the front shows the slice being played, exactly like the 2D bars, and each slice left behind
// keeps its bars. By the end of a song the whole track lies behind the live row. Rows follow the song position, so
// playback speed doesn't stretch them and seeking jumps to the matching row.
// Built as its own bundle (dist/terrain.js), loaded only when 3D is chosen.
// One row per half second of song (fewer for very long tracks), each a separate slab with a gap behind it, so the
// depth reads clearly.
const MAX_ROWS = 600;
const MIN_STEP_SECONDS = 0.5;
// The whole song spans this depth, however long it is.
const SONG_DEPTH = 24;
const WIDTH = 10;
// Share of each slot taken by a bar; the rest is the gap, as between the 2D bars.
const BAR_FILL = 0.82;
const ROW_FILL = 0.6;
// Full-level bar height (the row is WIDTH wide).
const HEIGHT = 3.2;
// Peak caps as thick, relative to full height, as the 2D markers (2px on a ~500px plot).
const PEAK_THICKNESS = 0.005;
// The default (and double-click) view's angle as the song goes on (inspired by views picked by hand): it swings from
// the wave's right toward the front and settles lower. at: share of the song played. azimuth: degrees around
// (negative is the wave's own right, our left, since the live slice faces us). elevation: degrees above level.
// The distance isn't fixed: the camera backs off just enough to fit what has been played so far in the panel.
const VIEW_ANGLES = [
  { at: 0, azimuth: -35, elevation: 30 },
  { at: 0.5, azimuth: -23, elevation: 18 },
  { at: 1, azimuth: -17, elevation: 20 }
];
// At the start, still frame at least this much depth so the first seconds aren't a close-up.
const MIN_FIT_DEPTH = 4;
// The default view's distance relative to an exact fit (1 = exact, below is closer, above is further out).
const VIEW_CLOSER = 1.02;
// Where the terrain sits horizontally on screen, as a share of half the view's width (positive = to the right).
const VIEW_SHIFT = 0.04;
// How long double-click takes to fly back to that view.
const FLY_MS = 700;
// The song behind the live slice is mixed this far toward the background, so the live slice stands out.
const HISTORY_FADE = 0.1;
// At full Sheet strength, how many rows (half a second each) the sheet blends over in time (Gaussian width).
const SHEET_MAX_SIGMA = 6;
// How far the floor grid reaches behind the song's start.
const GRID_MARGIN = 2;
// A line across the floor every 10 seconds of song, always, labelled with its time.
const GRID_SECONDS = 10;

// Frequencies marked on the floor, placed on the bars' log scale; the first label carries the unit.
const GRID_FREQUENCIES = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const frequencyLabel = (hz, first) => `${hz >= 1000 ? `${hz / 1000}k` : hz}${first ? " Hz" : ""}`;

const timeLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export class Terrain {
  constructor(container, columns) {
    this.container = container;
    this.columns = 0;
    this.track = null;
    this.rows = 0;
    this.step = MIN_STEP_SECONDS;
    this.rowDepth = 0;
    this.current = -1;
    this.matrix = new Matrix4();
    this.height = HEIGHT;
    // Shared with the bar shaders.
    this.fullHeight = { value: this.height };

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const canvas = this.renderer.domElement;
    Object.assign(canvas.style, { width: "100%", height: "100%", display: "block", touchAction: "none" });
    container.append(canvas);

    this.scene = new Scene();
    // A faint haze only at the far end of a long view.
    this.scene.fog = new Fog(0xffffff, 45, 110);
    this.camera = new PerspectiveCamera(38, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, canvas);
    // Free camera: rotate all the way around (below too), pan (right-drag or shift-drag) and zoom; only the zoom has
    // loose limits so the bars can't be lost.
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 120;
    // The camera turns around the middle of the live row. Until the view is rotated or zoomed by hand, it is refitted
    // to the panel on every resize so every bar, lowest to highest frequency and full height, is in view.
    // Double-click returns to that fitted view.
    this.fitted = true;
    // Grabbing the view stops refitting, and stops a fly-back midway.
    this.controls.addEventListener("start", () => {
      this.fitted = false;
      this.flight = null;
    });
    canvas.addEventListener("dblclick", () => {
      this.fitted = true;
      this.fit({ fly: true });
    });

    // Unit boxes standing on their base, scaled per bar.
    this.box = new BoxGeometry(1, 1, 1);
    this.box.translate(0, 0.5, 0);
    this.colors = { low: new Color(), high: new Color(), peak: new Color(), background: new Color() };
    this.sheetStrength = 0;
    this.materials = { history: this.gradientMaterial({ value: HISTORY_FADE }), sheet: this.gradientMaterial({ value: HISTORY_FADE }), live: this.gradientMaterial({ value: 0 }), peak: new MeshLambertMaterial({ color: this.colors.peak, transparent: true }) };
    // Rows sit along the song inside this group; it moves back as the song plays, keeping the live row at the front.
    this.history = new Group();
    this.scene.add(this.history);
    // A faint floor grid under the played part: a line across every few seconds of song, and the two sides.
    this.gridMaterial = new LineBasicMaterial({ color: new Color(), transparent: true, opacity: 0.45 });
    this.grid = new LineSegments(new BufferGeometry(), this.gridMaterial);
    this.grid.frustumCulled = false;
    this.history.add(this.grid);
    // The rest of the song's grid, ahead of the live row, drawn faint.
    this.futureGridMaterial = new LineBasicMaterial({ color: new Color(), transparent: true, opacity: 0.18 });
    this.futureGrid = new LineSegments(new BufferGeometry(), this.futureGridMaterial);
    this.futureGrid.frustumCulled = false;
    this.history.add(this.futureGrid);
    // Time labels by the grid's lines, along the left edge of the floor.
    this.labels = [];
    this.frequencyLabels = [];
    this.labelColor = "rgb(128, 128, 128)";
    // The analyser's frequency range, set by update(); the frequency lines are placed by it.
    this.range = [24, 24000];
    this.setColumns(columns);
    // Light mostly from above and a little from the right. Front faces show exactly the 2D colors (ambient plus the
    // light on them adds up to π, which three's lighting divides by); tops come out clearly brighter and the sides
    // darker, so each bar's outline stands out against the ones behind it.
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 3.7);
    sun.position.set(0.298, 0.844, 0.447);
    this.scene.add(sun);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // The bar count matches the 2D view's, which depends on its width; a change rebuilds the bars and starts the
  // terrain over from the current point of the song.
  setColumns(columns) {
    if (columns === this.columns) return;
    for (const mesh of [this.bars, this.liveBars, this.peakCaps, this.sheet]) {
      mesh?.removeFromParent();
      mesh?.dispose();
    }
    this.columns = columns;
    this.heights = new Float32Array(columns * MAX_ROWS);
    this.bars = new InstancedMesh(this.box, this.materials.history, columns * MAX_ROWS);
    this.bars.count = 0;
    // The live row, drawn on its own at full color at the front.
    this.liveBars = new InstancedMesh(this.box, this.materials.live, columns);
    this.liveBars.count = 0;
    this.peakCaps = new InstancedMesh(this.box, this.materials.peak, columns);
    // Bar heights change every frame, so bounds computed once would cull bars wrongly while rotating.
    for (const mesh of [this.bars, this.liveBars, this.peakCaps]) mesh.frustumCulled = false;
    this.history.add(this.bars);
    this.scene.add(this.liveBars, this.peakCaps);
    this.buildSheet();
    this.track = null;
    this.rows = 0;
  }

  // The sheet: one smooth surface through the song's rows (instead of separate bars), blended over time. Its vertices
  // sit at the bar centres of every row; heights and normals are recomputed only near the live row.
  buildSheet() {
    const { columns } = this;
    const geometry = new BufferGeometry();
    const positions = new Float32Array(columns * MAX_ROWS * 3);
    const normals = new Float32Array(columns * MAX_ROWS * 3);
    const slot = WIDTH / columns;
    for (let r = 0; r < MAX_ROWS; r++) {
      for (let i = 0; i < columns; i++) {
        const v = (r * columns + i) * 3;
        positions[v] = -WIDTH / 2 + slot / 2 + i * slot;
        normals[v + 1] = 1;
      }
    }
    const index = new Uint32Array((MAX_ROWS - 1) * (columns - 1) * 6);
    let n = 0;
    for (let r = 0; r < MAX_ROWS - 1; r++) {
      for (let i = 0; i < columns - 1; i++) {
        const a = r * columns + i;
        const b = a + 1;
        const c = a + columns;
        const d = c + 1;
        index.set([a, c, b, b, c, d], n);
        n += 6;
      }
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    this.materials.sheet.side = DoubleSide;
    this.sheet = new Mesh(geometry, this.materials.sheet);
    this.sheet.frustumCulled = false;
    this.history.add(this.sheet);
    this.applySheetVisibility();
  }

  // Spreads the sheet's rows along the song (row depth depends on the track's length).
  layoutSheet() {
    const position = this.sheet.geometry.attributes.position;
    for (let r = 0; r < MAX_ROWS; r++) {
      for (let i = 0; i < this.columns; i++) position.setZ(r * this.columns + i, r * this.rowDepth);
    }
    position.needsUpdate = true;
    this.sheet.geometry.setDrawRange(0, 0);
  }

  // Sheet strength, 0-1: 0 shows the song as bars; above that it's a sheet, blended over more time the higher it goes.
  setSheet(strength) {
    this.sheetStrength = Math.min(1, Math.max(0, strength));
    this.applySheetVisibility();
    if (this.sheetStrength > 0 && this.current >= 0) this.updateSheet(0, this.current);
  }

  applySheetVisibility() {
    if (this.bars) this.bars.visible = this.sheetStrength === 0;
    if (this.sheet) this.sheet.visible = this.sheetStrength > 0;
  }

  // Recomputes the sheet's heights for rows from..to (each a Gaussian blend of the rows around it, up to the live row)
  // and the normals around them, for smooth shading.
  updateSheet(from, to) {
    const { columns, heights } = this;
    const last = this.current;
    if (last < 0) return;
    const sigma = Math.max(0.5, this.sheetStrength * SHEET_MAX_SIGMA);
    const radius = Math.ceil(sigma * 2.5);
    const start = Math.max(0, from - radius);
    const end = Math.min(last, to);
    const weights = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
    const position = this.sheet.geometry.attributes.position;
    for (let r = start; r <= end; r++) {
      for (let i = 0; i < columns; i++) {
        let sum = 0;
        let total = 0;
        for (let k = -radius; k <= radius; k++) {
          const row = r + k;
          if (row < 0 || row > last) continue;
          sum += heights[row * columns + i] * weights[k + radius];
          total += weights[k + radius];
        }
        position.setY(r * columns + i, (sum / total) * this.height);
      }
    }
    const normal = this.sheet.geometry.attributes.normal;
    const slot = WIDTH / columns;
    const y = (r, i) => position.getY(Math.min(last, Math.max(0, r)) * columns + Math.min(columns - 1, Math.max(0, i)));
    for (let r = Math.max(0, start - 1); r <= Math.min(last, end + 1); r++) {
      for (let i = 0; i < columns; i++) {
        const dx = (y(r, i + 1) - y(r, i - 1)) / (2 * slot);
        const dz = (y(r + 1, i) - y(r - 1, i)) / (2 * this.rowDepth);
        const length = Math.hypot(dx, 1, dz);
        normal.setXYZ(r * columns + i, -dx / length, 1 / length, -dz / length);
      }
    }
    const firstRow = Math.max(0, start - 1);
    const lastRow = Math.min(MAX_ROWS - 1, end + 1);
    position.addUpdateRange(firstRow * columns * 3, (lastRow - firstRow + 1) * columns * 3);
    normal.addUpdateRange(firstRow * columns * 3, (lastRow - firstRow + 1) * columns * 3);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    this.sheet.geometry.setDrawRange(0, last * (columns - 1) * 6);
  }

  // Colors each bar by height like the 2D bars' vertical gradient: dark at the bottom, light at full level, so a short
  // bar stays dark. The height comes from each vertex's position in the scene.
  // fade: a { value } uniform, how far the colors are mixed toward the background (0 = full color).
  gradientMaterial(fade) {
    const material = new MeshLambertMaterial();
    material.onBeforeCompile = shader => {
      shader.uniforms.lowColor = { value: this.colors.low };
      shader.uniforms.highColor = { value: this.colors.high };
      shader.uniforms.fadeColor = { value: this.colors.background };
      shader.uniforms.fade = fade;
      shader.uniforms.fullHeight = this.fullHeight;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying float vBarHeight;\nvoid main() {")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n#ifdef USE_INSTANCING\nvBarHeight = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;\n#else\nvBarHeight = (modelMatrix * vec4(transformed, 1.0)).y;\n#endif");
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vBarHeight;\nuniform vec3 lowColor;\nuniform vec3 highColor;\nuniform vec3 fadeColor;\nuniform float fade;\nuniform float fullHeight;\nvoid main() {")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( mix(mix(lowColor, highColor, clamp(vBarHeight / fullHeight, 0.0, 1.0)), fadeColor, fade), opacity );");
    };
    return material;
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.fitted) this.fit();
  }

  // The default view for the current point of the song: the angle eased along VIEW_ANGLES, aimed a little into the
  // played part, and as close as it can be while the played part (song start to live row), the floor's width and the
  // full bar height fit the panel. It adapts to how much has played and to the panel's size; at the end the whole
  // song is in view.
  fitView() {
    const progress = this.rows > 1 ? Math.min(1, Math.max(0, this.current) / (this.rows - 1)) : 0;
    const next = Math.max(1, VIEW_ANGLES.findIndex(key => key.at >= progress));
    const from = VIEW_ANGLES[next - 1];
    const to = VIEW_ANGLES[next];
    const t = to.at > from.at ? (progress - from.at) / (to.at - from.at) : 0;
    const ease = t * t * (3 - 2 * t);
    const azimuth = ((from.azimuth + (to.azimuth - from.azimuth) * ease) * Math.PI) / 180;
    const elevation = ((from.elevation + (to.elevation - from.elevation) * ease) * Math.PI) / 180;
    const direction = new Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));

    const depth = Math.max(MIN_FIT_DEPTH, Math.max(0, this.current) * this.rowDepth);
    const half = WIDTH / 2 + 1;
    const corners = [];
    // A snug fit: three quarters of full bar height (peaks may poke out) and the oldest tenth of the song may reach the edge.
    for (const x of [-half, half]) for (const y of [0, this.height * 0.75]) for (const z of [-depth * 0.9, 0.8]) corners.push(new Vector3(x, y, z));
    const target = new Vector3(0, this.height * 0.3, -depth * 0.45);
    const probe = this.camera.clone();
    const point = new Vector3();
    const place = distance => {
      probe.position.copy(target).addScaledVector(direction, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld();
    };
    // Where the corners land on screen (-1..1 each way) from a distance.
    const extents = distance => {
      place(distance);
      const box = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity, behind: false };
      for (const corner of corners) {
        point.copy(corner).project(probe);
        box.left = Math.min(box.left, point.x);
        box.right = Math.max(box.right, point.x);
        box.bottom = Math.min(box.bottom, point.y);
        box.top = Math.max(box.top, point.y);
        box.behind ||= point.z >= 1;
      }
      return box;
    };
    // The closest distance at which every corner lands inside the view, found by bisection.
    const closestFit = () => {
      let near = 1;
      let far = this.controls.maxDistance;
      for (let i = 0; i < 30; i++) {
        const middle = (near + far) / 2;
        const box = extents(middle);
        if (!box.behind && box.left >= -1 && box.right <= 1 && box.bottom >= -1 && box.top <= 1) far = middle;
        else near = middle;
      }
      return far;
    };
    // Seen at an angle the terrain isn't centred on the aim point, so shift the aim until its outline is centred on
    // screen, refitting each time (centred, it fits closer).
    let distance = closestFit();
    for (let pass = 0; pass < 3; pass++) {
      const box = extents(distance);
      const halfHeight = distance * Math.tan((probe.fov * Math.PI) / 360);
      const right = new Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
      target.addScaledVector(right, ((box.left + box.right) / 2) * halfHeight * probe.aspect);
      target.addScaledVector(up, ((box.bottom + box.top) / 2) * halfHeight);
      distance = closestFit();
    }
    // Nudge the terrain sideways on screen: moving the aim the other way moves the picture this way.
    {
      const halfHeight = distance * Math.tan((probe.fov * Math.PI) / 360);
      place(distance);
      target.addScaledVector(new Vector3().setFromMatrixColumn(probe.matrixWorld, 0), -VIEW_SHIFT * halfHeight * probe.aspect);
    }
    // Relative to an exact fit (VIEW_CLOSER).
    const far = distance * VIEW_CLOSER;
    return { position: target.clone().addScaledVector(direction, far), target };
  }

  // fly: glide there (double-click) instead of jumping (resizes).
  fit({ fly = false } = {}) {
    const { position, target } = this.fitView();
    if (fly) {
      this.flight = { start: performance.now(), fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), position, target };
      return;
    }
    this.flight = null;
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.controls.update();
  }

  // While the default view is kept (not moved by hand, not flying back), it eases along as the played part grows.
  followFit() {
    if (!this.fitted || this.flight) return;
    const { position, target } = this.fitView();
    this.camera.position.lerp(position, 0.08);
    this.controls.target.lerp(target, 0.08);
  }

  // Moves the camera along a fly-back, easing in and out.
  stepFlight() {
    const flight = this.flight;
    if (!flight) return;
    const progress = Math.min(1, (performance.now() - flight.start) / FLY_MS);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    this.camera.position.lerpVectors(flight.fromPosition, flight.position, eased);
    this.controls.target.lerpVectors(flight.fromTarget, flight.target, eased);
    if (progress === 1) this.flight = null;
  }

  // A new track (or a newly known length) starts an empty terrain sized to the song.
  startTrack(track, duration) {
    this.track = track;
    this.step = Math.max(MIN_STEP_SECONDS, duration / MAX_ROWS);
    this.rows = Math.min(MAX_ROWS, Math.ceil(duration / this.step) + 1);
    this.rowDepth = SONG_DEPTH / this.rows;
    this.buildGrid(duration);
    this.layoutSheet();
    this.heights.fill(0);
    this.current = -1;
    this.bars.count = 0;
    this.liveBars.count = 0;
  }

  // A floor grid reaching one cell past the bars on each side (and a little behind the song's start), covering only
  // the played part, up to the live row:
  // - across the song, a line every 10 seconds, labelled with the time along the left edge;
  // - along the song, a line at each marked frequency (on the bars' log scale), labelled in front of the live row,
  //   plus the floor's two edges.
  buildGrid(duration) {
    this.duration = duration;
    this.gridInterval = GRID_SECONDS;
    const ticks = Math.floor(duration / this.gridInterval);
    const half = WIDTH / 2 + 1;
    const [minFreq, maxFreq] = this.range;
    const frequencies = GRID_FREQUENCIES.filter(hz => hz > minFreq && hz < maxFreq);
    const xOf = hz => -WIDTH / 2 + (WIDTH * Math.log(hz / minFreq)) / Math.log(maxFreq / minFreq);
    // The floor's edges, the start of the bar row (where the frequency axis begins) and the marked frequencies. (The
    // high end, around 22-24 kHz, would sit right next to the 20k line.)
    const lengthwise = [-half, half, -WIDTH / 2, ...frequencies.map(xOf)];
    this.gridLengthwise = lengthwise.length;
    // Lengthwise lines first (their near end follows the live row), then the song's start, then one line per tick.
    const points = new Float32Array((this.gridLengthwise + 1 + ticks) * 6);
    lengthwise.forEach((x, i) => points.set([x, -0.002, -GRID_MARGIN, x, -0.002, 0], i * 6));
    points.set([-half, -0.002, 0, half, -0.002, 0], this.gridLengthwise * 6);
    for (let k = 1; k <= ticks; k++) {
      const z = (k * this.gridInterval / this.step) * this.rowDepth;
      points.set([-half, -0.002, z, half, -0.002, z], (this.gridLengthwise + k) * 6);
    }
    this.grid.geometry.dispose();
    this.grid.geometry = new BufferGeometry();
    this.grid.geometry.setAttribute("position", new BufferAttribute(points, 3));
    this.grid.geometry.setDrawRange(0, 0);

    // The faint part to come: tick lines first (so the ones already played can be skipped from the start of the draw
    // range), then the lengthwise lines from the live row to the song's end.
    this.gridTicks = ticks;
    const songEnd = this.rows * this.rowDepth;
    const future = new Float32Array((ticks + this.gridLengthwise) * 6);
    for (let k = 1; k <= ticks; k++) {
      const z = (k * this.gridInterval / this.step) * this.rowDepth;
      future.set([-half, -0.002, z, half, -0.002, z], (k - 1) * 6);
    }
    lengthwise.forEach((x, i) => future.set([x, -0.002, 0, x, -0.002, songEnd], (ticks + i) * 6));
    this.futureGrid.geometry.dispose();
    this.futureGrid.geometry = new BufferGeometry();
    this.futureGrid.geometry.setAttribute("position", new BufferAttribute(future, 3));
    this.futureGrid.geometry.setDrawRange(0, 0);

    for (const label of [...this.labels, ...this.frequencyLabels]) {
      label.removeFromParent();
      label.material.map.dispose();
      label.material.dispose();
    }
    // Time labels move with the song; frequency labels stay just in front of the live row.
    this.labels = [];
    for (let k = 0; k <= ticks; k++) {
      const label = this.makeLabel(timeLabel(k * this.gridInterval));
      label.position.set(-half - 0.4, 0.12, (k * this.gridInterval / this.step) * this.rowDepth);
      this.history.add(label);
      this.labels.push(label);
    }
    this.frequencyLabels = frequencies.map((hz, i) => {
      const label = this.makeLabel(frequencyLabel(hz, i === 0));
      label.position.set(xOf(hz), 0.12, 0.45);
      this.scene.add(label);
      return label;
    });
  }

  makeLabel(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 64;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const label = new Sprite(new SpriteMaterial({ map: texture, transparent: true, opacity: 0.6, depthWrite: false }));
    label.userData.text = text;
    label.scale.set(0.6, 0.24, 1);
    label.visible = false;
    this.drawLabel(label);
    return label;
  }

  drawLabel(label) {
    const canvas = label.material.map.image;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "600 36px Inter, ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = this.labelColor;
    context.fillText(label.userData.text, canvas.width / 2, canvas.height / 2);
    label.material.map.needsUpdate = true;
  }

  updateGrid(row) {
    if (!this.gridInterval) return;
    const position = this.grid.geometry.attributes.position;
    const end = row * this.rowDepth;
    for (let i = 0; i < this.gridLengthwise; i++) position.setZ(i * 2 + 1, end);
    position.needsUpdate = true;
    const ticks = Math.floor((row * this.step) / this.gridInterval);
    this.grid.geometry.setDrawRange(0, (this.gridLengthwise + 1 + ticks) * 2);
    // The faint grid ahead starts at the live row and skips the ticks already played.
    const future = this.futureGrid.geometry.attributes.position;
    for (let i = 0; i < this.gridLengthwise; i++) future.setZ((this.gridTicks + i) * 2, end);
    future.needsUpdate = true;
    this.futureGrid.geometry.setDrawRange(ticks * 2, (this.gridTicks - ticks + this.gridLengthwise) * 2);
    // Every time label shows; those still to come are faint like their lines.
    this.labels.forEach((label, k) => {
      label.visible = true;
      label.material.opacity = k <= ticks ? 0.6 : 0.25;
    });
    for (const label of this.frequencyLabels) label.visible = true;
  }

  // Writes a row's bars into the history (at its place in the song) or, with live, into the live row at the front.
  placeRow(row, live = false) {
    const { columns } = this;
    const slot = WIDTH / columns;
    const left = -WIDTH / 2 + slot / 2;
    const mesh = live ? this.liveBars : this.bars;
    for (let i = 0; i < columns; i++) {
      // A bar at silence keeps a sliver, like the 2D bars' 1px minimum.
      this.matrix.makeScale(slot * BAR_FILL, Math.max(0.005, this.heights[row * columns + i] * this.height), Math.max(0.05, this.rowDepth * ROW_FILL));
      this.matrix.setPosition(left + i * slot, 0, live ? 0 : row * this.rowDepth);
      mesh.setMatrixAt(live ? i : row * columns + i, this.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Records the moment into the terrain. Runs while music plays whichever view is showing, so switching to 2D (or
  // away from the visualizer) leaves no gap; only drawing waits until 3D is on screen.
  // levels: one 0-1 value per band (the same values the 2D bars show). playing: paused holds everything still.
  // track/time/duration: which song and where in it. range: the analyser's [lowest, highest] frequency, which places
  // the frequency lines.
  record(levels, { playing, track, time, duration, range }) {
    if (range && (range[0] !== this.range[0] || range[1] !== this.range[1])) {
      this.range = range;
      if (this.rows) {
        this.buildGrid(this.duration);
        this.updateGrid(this.current);
      }
    }
    const { columns, heights } = this;
    if (track && Number.isFinite(duration) && duration > 0 && (track !== this.track || this.rows === 0)) this.startTrack(track, duration);
    if (!track) {
      this.track = null;
      this.rows = 0;
      this.bars.count = 0;
      this.liveBars.count = 0;
      this.grid.geometry.setDrawRange(0, 0);
      this.futureGrid.geometry.setDrawRange(0, 0);
      for (const label of [...this.labels, ...this.frequencyLabels]) label.visible = false;
    }
    if (playing && this.rows) {
      const row = Math.min(this.rows - 1, Math.max(0, Math.floor(time / this.step)));
      const previous = this.current;
      // Seeking back clears what came after, so the live row is always the newest.
      if (row < this.current) {
        heights.fill(0, (row + 1) * columns);
        for (let r = row + 1; r <= this.current; r++) this.placeRow(r);
      }
      for (let i = 0; i < columns; i++) heights[row * columns + i] = levels[i] ?? 0;
      // Rows left behind join the history (skipped ones by seeking forward show as silence); the live row is drawn on
      // its own at the front.
      for (let r = Math.max(0, this.current); r < row; r++) this.placeRow(r);
      this.placeRow(row, true);
      this.current = row;
      this.bars.count = row * columns;
      this.liveBars.count = columns;
      this.history.position.z = -row * this.rowDepth;
      this.updateGrid(row);
      // The sheet follows: rows around the live one change as it does (and after a seek, from where it jumped).
      if (this.sheetStrength > 0) this.updateSheet(Math.min(previous < 0 ? 0 : previous, row), row);
    }
  }

  // Draws the terrain. peaks: the 2D view's peak markers, shown as caps on the live row. Colors are [r, g, b] (0-255).
  render({ peaks, playing, low, high, peak, background, grid }) {
    const { columns } = this;
    const rgb = (color, [r, g, b]) => color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
    rgb(this.colors.low, low);
    rgb(this.colors.high, high);
    rgb(this.colors.peak, peak);
    // Paused, the peak caps fade like the 2D markers do.
    const opacity = this.materials.peak.opacity;
    this.materials.peak.opacity = opacity + ((playing ? 1 : 0.3) - opacity) * 0.15;
    rgb(this.colors.background, background);
    rgb(this.gridMaterial.color, grid);
    // Materials copy a color when created rather than sharing it, so the faint grid ahead takes the theme color here too.
    this.futureGridMaterial.color.copy(this.gridMaterial.color);
    // Labels follow the theme too.
    const labelColor = `rgb(${grid.join(", ")})`;
    if (labelColor !== this.labelColor) {
      this.labelColor = labelColor;
      for (const label of [...this.labels, ...this.frequencyLabels]) this.drawLabel(label);
    }
    this.scene.fog.color.copy(this.colors.background);

    // Peak caps sit on the live row, like the 2D view's.
    const slot = WIDTH / columns;
    const left = -WIDTH / 2 + slot / 2;
    for (let i = 0; i < columns; i++) {
      const visible = this.rows > 0 && (peaks[i] ?? 0) > 0.01;
      this.matrix.makeScale(slot * BAR_FILL, visible ? this.height * PEAK_THICKNESS : 0.0001, Math.max(0.05, this.rowDepth * ROW_FILL));
      this.matrix.setPosition(left + i * slot, (peaks[i] ?? 0) * this.height, 0);
      this.peakCaps.setMatrixAt(i, this.matrix);
    }
    this.peakCaps.instanceMatrix.needsUpdate = true;
    this.stepFlight();
    this.followFit();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

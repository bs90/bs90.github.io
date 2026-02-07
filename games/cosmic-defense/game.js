import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

class CosmicDefense {
  constructor() {
    // Game state
    this.score = 0;
    this.wave = 0;
    this.health = 100;
    this.maxHealth = 100;
    this.enemiesRemainingInWave = 0;
    this.gameActive = false;
    this.isInVR = false;
    this.chargeTime = 0.4;
    this.spawnTimer = 0;
    this.gazeChargeTime = 0;
    this.gazeTarget = null;
    this.damageFlash = 0;
    this.waveAnnounceTimer = 0;
    this.prevScore = -1;
    this.prevHealth = -1;
    this.prevWave = -1;

    // Temp objects (avoid allocations in loop)
    this._dir = new THREE.Vector3();
    this._tempVec = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 80;
    this._clock = new THREE.Clock();

    // Touch controls
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.isDragging = false;

    this.initRenderer();
    this.initScene();
    this.initCamera();
    this.initLighting();
    this.initStarfield();
    this.initReticle();
    this.initDamageOverlay();
    this.initEnemyAssets();
    this.initEnemyPool();
    this.initParticles();
    this.initAmbientDust();
    this.initVRHud();
    this.initAudio();
    this.initControls();
    this.initWebXR();

    // UI bindings
    document.getElementById('start-btn').addEventListener('click', () => this.startGame());
    document.getElementById('restart-btn').addEventListener('click', () => this.startGame());
    window.addEventListener('resize', () => this.onWindowResize());
  }

  // ─── Renderer ───────────────────────────────────────────
  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);
  }

  // ─── Scene ──────────────────────────────────────────────
  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020010);
    this.scene.fog = new THREE.FogExp2(0x020010, 0.008);
  }

  // ─── Camera ─────────────────────────────────────────────
  initCamera() {
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 1.6, 0);
    this.cameraGroup = new THREE.Group();
    this.cameraGroup.add(this.camera);
    this.scene.add(this.cameraGroup);
  }

  // ─── Lighting ───────────────────────────────────────────
  initLighting() {
    const ambient = new THREE.AmbientLight(0x222244, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(5, 10, 7);
    this.scene.add(directional);

    const playerLight = new THREE.PointLight(0x4488ff, 1.0, 20);
    this.camera.add(playerLight);
  }

  // ─── Starfield ──────────────────────────────────────────
  initStarfield() {
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 100 + Math.random() * 400;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      const c = Math.random();
      if (c < 0.7) { colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1; }
      else if (c < 0.85) { colors[i * 3] = 0.7; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 1; }
      else { colors[i * 3] = 1; colors[i * 3 + 1] = 0.95; colors[i * 3 + 2] = 0.8; }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });

    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  // ─── Reticle ────────────────────────────────────────────
  initReticle() {
    this.reticleGroup = new THREE.Group();

    // Outer ring
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.022, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    this.reticleOuterMat = outerRing.material;

    // Inner dot
    const innerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.003, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );

    // Charge ring
    this.chargeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.024, 0.028, 32, 1, 0, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );

    this.reticleGroup.add(outerRing, innerDot, this.chargeRing);
    this.reticleGroup.position.set(0, 0, -1.5);
    this.camera.add(this.reticleGroup);
  }

  // ─── Damage Overlay ─────────────────────────────────────
  initDamageOverlay() {
    const geo = new THREE.PlaneGeometry(4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    this.damageOverlay = new THREE.Mesh(geo, mat);
    this.damageOverlay.position.set(0, 0, -0.3);
    this.damageOverlay.renderOrder = 999;
    this.camera.add(this.damageOverlay);
  }

  // ─── Enemy Assets ───────────────────────────────────────
  initEnemyAssets() {
    this.asteroidGeo = new THREE.IcosahedronGeometry(0.5, 0);
    this.asteroidMat = new THREE.MeshStandardMaterial({
      color: 0x886644, roughness: 0.9, flatShading: true,
    });

    this.droneGeo = new THREE.OctahedronGeometry(0.4, 0);
    this.droneMat = new THREE.MeshStandardMaterial({
      color: 0xff3333, emissive: 0x441111, roughness: 0.3, flatShading: true,
    });

    this.cruiserGeo = new THREE.BoxGeometry(0.8, 0.3, 1.2);
    this.cruiserMat = new THREE.MeshStandardMaterial({
      color: 0x8833ff, emissive: 0x220066, roughness: 0.4, flatShading: true,
    });
  }

  // ─── Enemy Pool ─────────────────────────────────────────
  initEnemyPool() {
    this.enemyPool = [];
    this.activeEnemies = [];
    const POOL_SIZE = 50;

    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(this.asteroidGeo, this.asteroidMat.clone());
      mesh.visible = false;
      mesh.userData = {
        active: false,
        health: 1,
        speed: 1,
        type: 'asteroid',
        baseScale: 1,
        rotSpeed: new THREE.Vector3(),
        direction: new THREE.Vector3(),
      };
      this.scene.add(mesh);
      this.enemyPool.push(mesh);
    }
  }

  // ─── Particle System ────────────────────────────────────
  initParticles() {
    this.maxParticles = 500;
    this.particlePositions = new Float32Array(this.maxParticles * 3);
    this.particleColors = new Float32Array(this.maxParticles * 3);
    this.particleSizes = new Float32Array(this.maxParticles);
    this.particleVelocities = [];
    this.particleLifetimes = new Float32Array(this.maxParticles);
    this.particleMaxLifetimes = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particleVelocities.push(new THREE.Vector3());
      this.particleLifetimes[i] = 0;
      this.particleMaxLifetimes[i] = 0;
      this.particleSizes[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.particleColors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.particleSizes, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  // ─── Ambient Dust ───────────────────────────────────────
  initAmbientDust() {
    const dustCount = 100;
    const positions = new Float32Array(dustCount * 3);
    this.dustVelocities = [];

    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30 + 1.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
      this.dustVelocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.3
      ));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x4466aa,
      size: 0.15,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
  }

  // ─── VR HUD ─────────────────────────────────────────────
  initVRHud() {
    // Score sprite
    this.vrScoreCanvas = document.createElement('canvas');
    this.vrScoreCanvas.width = 512;
    this.vrScoreCanvas.height = 128;
    this.vrScoreTexture = new THREE.CanvasTexture(this.vrScoreCanvas);
    this.vrScoreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.vrScoreTexture, transparent: true })
    );
    this.vrScoreSprite.scale.set(0.5, 0.125, 1);
    this.vrScoreSprite.position.set(-0.35, 0.3, -1);
    this.vrScoreSprite.visible = false;
    this.camera.add(this.vrScoreSprite);

    // Health bar sprite
    this.vrHealthCanvas = document.createElement('canvas');
    this.vrHealthCanvas.width = 256;
    this.vrHealthCanvas.height = 32;
    this.vrHealthTexture = new THREE.CanvasTexture(this.vrHealthCanvas);
    this.vrHealthSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.vrHealthTexture, transparent: true })
    );
    this.vrHealthSprite.scale.set(0.4, 0.04, 1);
    this.vrHealthSprite.position.set(0, -0.32, -1);
    this.vrHealthSprite.visible = false;
    this.camera.add(this.vrHealthSprite);

    // VR Game Over sprite
    this.vrGameOverCanvas = document.createElement('canvas');
    this.vrGameOverCanvas.width = 512;
    this.vrGameOverCanvas.height = 256;
    this.vrGameOverTexture = new THREE.CanvasTexture(this.vrGameOverCanvas);
    this.vrGameOverSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.vrGameOverTexture, transparent: true })
    );
    this.vrGameOverSprite.scale.set(0.8, 0.4, 1);
    this.vrGameOverSprite.position.set(0, 0, -1.5);
    this.vrGameOverSprite.visible = false;
    this.camera.add(this.vrGameOverSprite);

    // VR Wave announce sprite
    this.vrWaveCanvas = document.createElement('canvas');
    this.vrWaveCanvas.width = 512;
    this.vrWaveCanvas.height = 128;
    this.vrWaveTexture = new THREE.CanvasTexture(this.vrWaveCanvas);
    this.vrWaveSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.vrWaveTexture, transparent: true })
    );
    this.vrWaveSprite.scale.set(0.6, 0.15, 1);
    this.vrWaveSprite.position.set(0, 0.1, -1.5);
    this.vrWaveSprite.visible = false;
    this.camera.add(this.vrWaveSprite);
  }

  // ─── Audio ──────────────────────────────────────────────
  initAudio() {
    this.audioCtx = null;
  }

  ensureAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  playShootSound() {
    try {
      this.ensureAudio();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, this.audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.12);
    } catch (e) { /* audio not available */ }
  }

  playExplosionSound() {
    try {
      this.ensureAudio();
      const bufferSize = this.audioCtx.sampleRate * 0.25;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.08));
      }
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      const gain = this.audioCtx.createGain();
      gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.25);
      source.connect(gain);
      gain.connect(this.audioCtx.destination);
      source.start();
    } catch (e) { /* audio not available */ }
  }

  playHitSound() {
    try {
      this.ensureAudio();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(60, this.audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.2);
    } catch (e) { /* audio not available */ }
  }

  playDamageSound() {
    try {
      this.ensureAudio();
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, this.audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch (e) { /* audio not available */ }
  }

  // ─── Controls ───────────────────────────────────────────
  initControls() {
    // Mouse look (desktop)
    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.euler.y -= dx * 0.003;
      this.euler.x -= dy * 0.003;
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    });

    this.renderer.domElement.addEventListener('mousedown', () => { this.isDragging = true; });
    this.renderer.domElement.addEventListener('mouseup', () => { this.isDragging = false; });

    // Touch look (mobile)
    this.renderer.domElement.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
        this.isDragging = true;
      }
    }, { passive: true });

    this.renderer.domElement.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.touchStartX;
      const dy = e.touches[0].clientY - this.touchStartY;
      this.euler.y -= dx * 0.004;
      this.euler.x -= dy * 0.004;
      this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    this.renderer.domElement.addEventListener('touchend', () => { this.isDragging = false; }, { passive: true });
  }

  // ─── WebXR ──────────────────────────────────────────────
  initWebXR() {
    this.renderer.xr.enabled = true;

    const vrButton = VRButton.createButton(this.renderer);
    document.body.appendChild(vrButton);

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.isInVR = true;
      document.getElementById('hud').style.display = 'none';
      this.vrScoreSprite.visible = true;
      this.vrHealthSprite.visible = true;
      this.prevScore = -1;
      this.prevHealth = -1;
      this.prevWave = -1;
    });

    this.renderer.xr.addEventListener('sessionend', () => {
      this.isInVR = false;
      if (this.gameActive) document.getElementById('hud').style.display = 'block';
      this.vrScoreSprite.visible = false;
      this.vrHealthSprite.visible = false;
      this.vrGameOverSprite.visible = false;
      this.vrWaveSprite.visible = false;
    });

    this.renderer.setAnimationLoop((timestamp, frame) => this.animate(timestamp, frame));
  }

  // ─── Game Flow ──────────────────────────────────────────
  startGame() {
    this.ensureAudio();

    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('game-over').style.display = 'none';
    if (!this.isInVR) document.getElementById('hud').style.display = 'block';
    this.vrGameOverSprite.visible = false;

    this.score = 0;
    this.wave = 0;
    this.health = this.maxHealth;
    this.gameActive = true;
    this.spawnTimer = 0;
    this.gazeChargeTime = 0;
    this.gazeTarget = null;
    this.damageFlash = 0;
    this.prevScore = -1;
    this.prevHealth = -1;
    this.prevWave = -1;

    // Clear enemies
    for (const e of this.activeEnemies) {
      e.visible = false;
      e.userData.active = false;
    }
    this.activeEnemies = [];

    // Clear particles
    for (let i = 0; i < this.maxParticles; i++) {
      this.particleLifetimes[i] = 0;
      this.particleSizes[i] = 0;
    }

    this.advanceWave();
  }

  advanceWave() {
    this.wave++;
    this.enemiesRemainingInWave = 5 + this.wave * 3;

    // Health regen between waves
    this.health = Math.min(this.maxHealth, this.health + 20);

    // Show wave announcement
    this.waveAnnounceTimer = 2.0;
    this.showWaveAnnouncement();
  }

  showWaveAnnouncement() {
    if (this.isInVR) {
      const ctx = this.vrWaveCanvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = '#ffaa00';
      ctx.font = 'bold 64px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(255, 170, 0, 0.8)';
      ctx.shadowBlur = 20;
      ctx.fillText(`WAVE ${this.wave}`, 256, 64);
      this.vrWaveTexture.needsUpdate = true;
      this.vrWaveSprite.visible = true;
      this.vrWaveSprite.material.opacity = 1;
    } else {
      const el = document.getElementById('wave-announce');
      el.textContent = `WAVE ${this.wave}`;
      el.style.display = 'block';
      el.style.animation = 'none';
      // Force reflow
      void el.offsetWidth;
      el.style.animation = 'waveIn 2s ease-out forwards';
      setTimeout(() => { el.style.display = 'none'; }, 2000);
    }
  }

  gameOver() {
    this.gameActive = false;

    // Clear enemies
    for (const e of this.activeEnemies) {
      e.visible = false;
      e.userData.active = false;
    }
    this.activeEnemies = [];

    if (this.isInVR) {
      // VR game over
      const ctx = this.vrGameOverCanvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 256);

      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 56px monospace';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(255, 50, 50, 0.8)';
      ctx.shadowBlur = 20;
      ctx.fillText('GAME OVER', 256, 70);

      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 32px monospace';
      ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
      ctx.shadowBlur = 10;
      ctx.fillText(`Score: ${this.score}`, 256, 130);

      ctx.fillStyle = '#ffaa00';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`Wave: ${this.wave}`, 256, 170);

      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '20px monospace';
      ctx.fillText('Gaze here to restart', 256, 220);

      this.vrGameOverTexture.needsUpdate = true;
      this.vrGameOverSprite.visible = true;
      this.vrScoreSprite.visible = false;
      this.vrHealthSprite.visible = false;
      this.vrRestartGazeTime = 0;
    } else {
      document.getElementById('hud').style.display = 'none';
      document.getElementById('game-over').style.display = 'flex';
      document.getElementById('final-score').textContent = `Score: ${this.score}`;
      document.getElementById('final-wave').textContent = `Wave: ${this.wave}`;
    }
  }

  damagePlayer(amount) {
    this.health -= amount;
    this.damageFlash = 0.3;
    this.playDamageSound();

    if (this.health <= 0) {
      this.health = 0;
      this.gameOver();
    }
  }

  // ─── Enemy Spawning ─────────────────────────────────────
  spawnEnemy() {
    const enemy = this.enemyPool.find(e => !e.userData.active);
    if (!enemy) return;

    const typeRoll = Math.random();
    let type, geo, mat, health, speed, scale;

    if (this.wave >= 3 && typeRoll > 0.7) {
      type = 'cruiser'; geo = this.cruiserGeo; mat = this.cruiserMat;
      health = 3; speed = 2 + this.wave * 0.2; scale = 1.2;
    } else if (this.wave >= 2 && typeRoll > 0.4) {
      type = 'drone'; geo = this.droneGeo; mat = this.droneMat;
      health = 2; speed = 4 + this.wave * 0.3; scale = 0.8;
    } else {
      type = 'asteroid'; geo = this.asteroidGeo; mat = this.asteroidMat;
      health = 1; speed = 3 + this.wave * 0.2; scale = 0.6 + Math.random() * 0.6;
    }

    enemy.geometry = geo;
    enemy.material = mat;
    enemy.scale.setScalar(scale);

    // Spawn on a sphere around the player
    const spawnDist = 40 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    enemy.position.set(
      spawnDist * Math.sin(phi) * Math.cos(theta),
      spawnDist * Math.sin(phi) * Math.sin(theta) + 1.6,
      spawnDist * Math.cos(phi)
    );

    // Direction toward player with slight offset
    enemy.userData.direction.copy(this.camera.position)
      .sub(enemy.position)
      .normalize();
    enemy.userData.direction.x += (Math.random() - 0.5) * 0.1;
    enemy.userData.direction.y += (Math.random() - 0.5) * 0.1;
    enemy.userData.direction.z += (Math.random() - 0.5) * 0.1;
    enemy.userData.direction.normalize();

    enemy.userData.active = true;
    enemy.userData.health = health;
    enemy.userData.speed = speed;
    enemy.userData.type = type;
    enemy.userData.baseScale = scale;
    enemy.userData.rotSpeed.set(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    enemy.visible = true;

    this.activeEnemies.push(enemy);
    this.enemiesRemainingInWave--;
  }

  updateSpawning(delta) {
    if (this.enemiesRemainingInWave <= 0) return;
    if (this.waveAnnounceTimer > 0) return; // Don't spawn during wave announcement

    this.spawnTimer += delta;
    const spawnInterval = Math.max(0.3, 2.0 - this.wave * 0.15);

    if (this.spawnTimer >= spawnInterval) {
      this.spawnTimer = 0;
      this.spawnEnemy();
      if (this.wave >= 4 && Math.random() > 0.5) this.spawnEnemy();
      if (this.wave >= 7 && Math.random() > 0.5) this.spawnEnemy();
    }
  }

  deactivateEnemy(enemy, idx) {
    enemy.visible = false;
    enemy.userData.active = false;
    this.activeEnemies.splice(idx, 1);
  }

  updateEnemies(delta, elapsed) {
    const playerPos = this.camera.position;
    const damageDistance = 2.0;

    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const enemy = this.activeEnemies[i];

      // Move
      enemy.position.addScaledVector(enemy.userData.direction, enemy.userData.speed * delta);

      // Rotate
      enemy.rotation.x += enemy.userData.rotSpeed.x * delta;
      enemy.rotation.y += enemy.userData.rotSpeed.y * delta;
      enemy.rotation.z += enemy.userData.rotSpeed.z * delta;

      // Pulse scale
      const pulse = 1 + Math.sin(elapsed * 3 + i) * 0.05;
      enemy.scale.setScalar(enemy.userData.baseScale * pulse);

      // Check distance to player
      const dist = enemy.position.distanceTo(playerPos);

      if (dist < damageDistance) {
        this.damagePlayer(10);
        this.createExplosion(enemy.position, 0xff4400);
        this.playExplosionSound();
        this.deactivateEnemy(enemy, i);
        continue;
      }

      // Out of range
      if (dist > 80) {
        this.deactivateEnemy(enemy, i);
      }
    }
  }

  // ─── Gaze Targeting ─────────────────────────────────────
  checkGazeTargeting(delta) {
    // Get camera world direction
    this.camera.getWorldDirection(this._dir);
    this._tempVec.copy(this.camera.position);

    // In VR, get camera world position
    if (this.isInVR) {
      this.camera.getWorldPosition(this._tempVec);
    }

    this._raycaster.set(this._tempVec, this._dir);

    const activeMeshes = this.activeEnemies;
    if (activeMeshes.length === 0) {
      this.gazeTarget = null;
      this.gazeChargeTime = 0;
      this.updateChargeRing(0);
      this.reticleOuterMat.color.setHex(0x00ffff);
      return;
    }

    const intersects = this._raycaster.intersectObjects(activeMeshes, false);

    if (intersects.length > 0) {
      const target = intersects[0].object;

      if (this.gazeTarget === target) {
        this.gazeChargeTime += delta;
      } else {
        this.gazeTarget = target;
        this.gazeChargeTime = 0;
      }

      const chargeProgress = Math.min(this.gazeChargeTime / this.chargeTime, 1.0);
      this.updateChargeRing(chargeProgress);
      this.reticleOuterMat.color.setHex(0xff4400);

      if (chargeProgress >= 1.0) {
        this.fireAtTarget(target);
        this.gazeChargeTime = 0;
      }
    } else {
      this.gazeTarget = null;
      this.gazeChargeTime = 0;
      this.updateChargeRing(0);
      this.reticleOuterMat.color.setHex(0x00ffff);
    }

    // VR game over restart via gaze
    if (this.isInVR && !this.gameActive && this.vrGameOverSprite.visible) {
      this._raycaster.set(this._tempVec, this._dir);
      const goIntersects = this._raycaster.intersectObject(this.vrGameOverSprite, false);
      if (goIntersects.length > 0) {
        this.vrRestartGazeTime = (this.vrRestartGazeTime || 0) + delta;
        if (this.vrRestartGazeTime >= 1.5) {
          this.startGame();
        }
      } else {
        this.vrRestartGazeTime = 0;
      }
    }
  }

  updateChargeRing(progress) {
    this.chargeRing.geometry.dispose();
    const angle = Math.max(progress * Math.PI * 2, 0.001);
    this.chargeRing.geometry = new THREE.RingGeometry(0.024, 0.028, 32, 1, 0, angle);
  }

  fireAtTarget(target) {
    this.playShootSound();
    target.userData.health -= 1;

    // Hit flash
    if (target.material.emissive) {
      const origEmissive = target.material.emissive.getHex();
      target.material.emissive.setHex(0xffffff);
      setTimeout(() => {
        if (target.material && target.material.emissive) {
          target.material.emissive.setHex(origEmissive);
        }
      }, 80);
    }

    if (target.userData.health <= 0) {
      // Destroyed
      const points = { asteroid: 10, drone: 25, cruiser: 50 }[target.userData.type] || 10;
      this.score += points;

      this.createExplosion(target.position.clone(), target.material.color.getHex());
      this.playExplosionSound();

      const idx = this.activeEnemies.indexOf(target);
      if (idx !== -1) this.deactivateEnemy(target, idx);

      this.gazeTarget = null;
      this.gazeChargeTime = 0;
    } else {
      this.playHitSound();
    }
  }

  // ─── Particles ──────────────────────────────────────────
  createExplosion(position, color) {
    const particleCount = 15;
    const col = new THREE.Color(color);

    for (let j = 0; j < particleCount; j++) {
      let idx = -1;
      for (let k = 0; k < this.maxParticles; k++) {
        if (this.particleLifetimes[k] <= 0) { idx = k; break; }
      }
      if (idx === -1) break;

      this.particlePositions[idx * 3] = position.x;
      this.particlePositions[idx * 3 + 1] = position.y;
      this.particlePositions[idx * 3 + 2] = position.z;

      this.particleVelocities[idx].set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      );

      this.particleColors[idx * 3] = Math.min(1, col.r * (0.8 + Math.random() * 0.4));
      this.particleColors[idx * 3 + 1] = Math.min(1, col.g * (0.8 + Math.random() * 0.4));
      this.particleColors[idx * 3 + 2] = Math.min(1, col.b * (0.5 + Math.random() * 0.5));

      this.particleSizes[idx] = 0.2 + Math.random() * 0.3;
      this.particleLifetimes[idx] = 0.8 + Math.random() * 0.4;
      this.particleMaxLifetimes[idx] = this.particleLifetimes[idx];
    }
  }

  updateParticles(delta) {
    let maxActiveIdx = 0;
    let hasActive = false;

    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particleLifetimes[i] <= 0) continue;

      hasActive = true;
      this.particleLifetimes[i] -= delta;

      if (this.particleLifetimes[i] <= 0) {
        this.particleSizes[i] = 0;
        continue;
      }

      this.particlePositions[i * 3] += this.particleVelocities[i].x * delta;
      this.particlePositions[i * 3 + 1] += this.particleVelocities[i].y * delta;
      this.particlePositions[i * 3 + 2] += this.particleVelocities[i].z * delta;

      this.particleVelocities[i].multiplyScalar(0.96);

      const lifeRatio = this.particleLifetimes[i] / this.particleMaxLifetimes[i];
      this.particleSizes[i] = lifeRatio * 0.3;

      maxActiveIdx = i;
    }

    if (hasActive) {
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.geometry.attributes.color.needsUpdate = true;
      this.particles.geometry.attributes.size.needsUpdate = true;
      this.particles.geometry.setDrawRange(0, maxActiveIdx + 1);
    } else {
      this.particles.geometry.setDrawRange(0, 0);
    }
  }

  // ─── Ambient Dust Update ────────────────────────────────
  updateDust(delta) {
    const positions = this.dust.geometry.attributes.position.array;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
      positions[i * 3] += this.dustVelocities[i].x * delta;
      positions[i * 3 + 1] += this.dustVelocities[i].y * delta;
      positions[i * 3 + 2] += this.dustVelocities[i].z * delta;

      // Wrap around player
      for (let a = 0; a < 3; a++) {
        const offset = a === 1 ? 1.6 : 0;
        if (positions[i * 3 + a] > 15 + offset) positions[i * 3 + a] = -15 + offset;
        if (positions[i * 3 + a] < -15 + offset) positions[i * 3 + a] = 15 + offset;
      }
    }

    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  // ─── HUD Updates ────────────────────────────────────────
  updateHtmlHud() {
    if (this.isInVR) return;

    if (this.score !== this.prevScore) {
      document.getElementById('score').textContent = `SCORE: ${this.score}`;
      this.prevScore = this.score;
    }

    if (this.wave !== this.prevWave) {
      document.getElementById('wave').textContent = `WAVE ${this.wave}`;
      this.prevWave = this.wave;
    }

    if (this.health !== this.prevHealth) {
      const pct = Math.max(0, this.health);
      document.getElementById('health-fill').style.width = `${pct}%`;
      const fill = document.getElementById('health-fill');
      if (pct > 60) fill.style.backgroundColor = '#00ff88';
      else if (pct > 30) fill.style.backgroundColor = '#ffaa00';
      else fill.style.backgroundColor = '#ff3333';
      this.prevHealth = this.health;
    }
  }

  updateVrHud() {
    if (!this.isInVR || !this.gameActive) return;

    const scoreChanged = this.score !== this.prevScore || this.wave !== this.prevWave;
    const healthChanged = this.health !== this.prevHealth;

    if (scoreChanged) {
      const ctx = this.vrScoreCanvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);

      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0, 255, 255, 0.5)';
      ctx.shadowBlur = 10;
      ctx.fillText(`SCORE: ${this.score}`, 10, 50);

      ctx.fillStyle = '#ffaa00';
      ctx.font = 'bold 30px monospace';
      ctx.shadowColor = 'rgba(255, 170, 0, 0.5)';
      ctx.fillText(`WAVE ${this.wave}`, 10, 100);

      this.vrScoreTexture.needsUpdate = true;
      this.prevScore = this.score;
      this.prevWave = this.wave;
    }

    if (healthChanged) {
      const ctx = this.vrHealthCanvas.getContext('2d');
      ctx.clearRect(0, 0, 256, 32);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(0, 0, 256, 32);

      const pct = Math.max(0, this.health) / this.maxHealth;
      ctx.fillStyle = pct > 0.6 ? '#00ff88' : pct > 0.3 ? '#ffaa00' : '#ff3333';
      ctx.fillRect(0, 0, 256 * pct, 32);

      // Border
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 256, 32);

      this.vrHealthTexture.needsUpdate = true;
      this.prevHealth = this.health;
    }
  }

  // ─── Reticle Pulse ──────────────────────────────────────
  updateReticle(elapsed) {
    const pulse = 1 + Math.sin(elapsed * 4) * 0.1;
    this.reticleGroup.scale.setScalar(pulse);
  }

  // ─── Resize ─────────────────────────────────────────────
  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ─── Main Loop ──────────────────────────────────────────
  animate(timestamp, frame) {
    const delta = Math.min(this._clock.getDelta(), 0.1);
    const elapsed = this._clock.getElapsedTime();

    // Always update dust and stars rotation for visual interest
    this.updateDust(delta);
    this.stars.rotation.y += delta * 0.002;

    // Non-VR camera
    if (!this.isInVR) {
      this.camera.quaternion.setFromEuler(this.euler);
    }

    if (!this.gameActive) {
      // Still check for VR game-over gaze restart
      if (this.isInVR && this.vrGameOverSprite.visible) {
        this.checkGazeTargeting(delta);
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Wave announce timer
    if (this.waveAnnounceTimer > 0) {
      this.waveAnnounceTimer -= delta;
      if (this.isInVR) {
        this.vrWaveSprite.material.opacity = Math.max(0, this.waveAnnounceTimer / 2);
        if (this.waveAnnounceTimer <= 0) this.vrWaveSprite.visible = false;
      }
    }

    // Game systems
    this.updateSpawning(delta);
    this.updateEnemies(delta, elapsed);
    this.checkGazeTargeting(delta);
    this.updateReticle(elapsed);
    this.updateParticles(delta);
    this.updateHtmlHud();
    this.updateVrHud();

    // Damage flash
    if (this.damageFlash > 0) {
      this.damageFlash -= delta;
      this.damageOverlay.material.opacity = Math.max(0, this.damageFlash * 1.5);
    }

    // Wave progression
    if (this.enemiesRemainingInWave <= 0 && this.activeEnemies.length === 0 && this.waveAnnounceTimer <= 0) {
      this.advanceWave();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start
const game = new CosmicDefense();

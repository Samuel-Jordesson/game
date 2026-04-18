import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

let scene, camera, renderer, orbit, transformControl;
let raycaster, mouse;
const objectsToIntersect = [];
const mixers = [];
const clock = new THREE.Clock();
let isTransforming = false;

// --- Efeito Cel Shading (Zelda Style) ---
const tones = new Uint8Array([80, 80, 80, 180, 180, 180, 255, 255, 255]);
const toonRamp = new THREE.DataTexture(tones, 3, 1, THREE.RedFormat);
toonRamp.minFilter = THREE.NearestFilter;
toonRamp.magFilter = THREE.NearestFilter;
toonRamp.generateMipmaps = false;
toonRamp.needsUpdate = true;

const selectedNameSpan = document.getElementById('selected-name');
const btnTranslate = document.getElementById('btn-translate');
const btnRotate = document.getElementById('btn-rotate');
const btnScale = document.getElementById('btn-scale');
const btnPaint = document.getElementById('btn-paint');

let floor;
let dirtFloor;
let splatCanvas, splatCtx, splatTexture;
let rockSplatCanvas, rockSplatCtx, rockSplatTexture;
let grassSplatCanvas, grassSplatCtx, grassSplatTexture;
let floraSplatCanvas, floraSplatCtx, floraSplatTexture;
let isPainting = false;
let isErasing = false; // Modo "Apagar" ativo
let brushSize = 50;
let currentMode = 'transform'; // ou 'paint'
let brushTextureId = 'terra'; // 'terra', 'grama' ou 'relevo'
let brushFoliageScale = 1.0;
let sculptStrength = 0.5;
let heightData = null; // Será inicializado no Init ou Load

// --- Folhagem (Grass) System ---
let editorGrassModel = null;
let editorGrassInstancedMeshes = [];
let editorGrassMatrices = [];
const MAX_GRASS = 10000;
const grassUniforms = {
    uTime: { value: 0 }
};

// Raycaster vertical para snapping ao terreno (grama no relevo)
const groundRaycaster = new THREE.Raycaster();
const downVec = new THREE.Vector3(0, -1, 0);

function getTerrainHeight(x, z) {
    if (!floor) return 0;
    groundRaycaster.set(new THREE.Vector3(x, 200, z), downVec);
    const hits = groundRaycaster.intersectObject(floor);
    if (hits.length > 0) return hits[0].point.y;
    return 0;
}

try {
    init();
    animate();
} catch (error) {
    alert("ERRO FATAL NO EDITOR: " + error.message + "\n" + error.stack);
}

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x203040); // Cor visível para sabermos que WebGL ligou
    scene.fog = new THREE.FogExp2(0x888888, 0.005);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1); // Remover Math.min temporariamente
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    document.body.appendChild(renderer.domElement);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // Sky
    const skyLoader = new THREE.TextureLoader();
    skyLoader.load('ceu/DaySkyHDRI027B_2K_TONEMAPPED.jpg', (skyTexture) => {
        skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture.colorSpace = THREE.SRGBColorSpace;
        scene.background = skyTexture;
        scene.environment = skyTexture;
    });

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Luz mais fraca = sombra mais escura
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    sunLight.position.set(20, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.radius = 1.5;
    scene.add(sunLight);

    // Chão
    const groundLoader = new THREE.TextureLoader();
    const groundBaseColor = groundLoader.load('textura-terra/Ground037_2K-PNG_Color.png');
    const groundNormal = groundLoader.load('textura-terra/Ground037_2K-PNG_NormalGL.png');
    const groundRoughness = groundLoader.load('textura-terra/Ground037_2K-PNG_Roughness.png');

    const repeatX = 100;
    const repeatY = 100;
    [groundBaseColor, groundNormal, groundRoughness].forEach(t => {
        if (t) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            t.anisotropy = maxAnisotropy;
            t.colorSpace = THREE.SRGBColorSpace;
        }
    });

    const floorGrid = 128; // 128x128 para relevo detalhado
    const floorGeometry = new THREE.PlaneGeometry(1000, 1000, floorGrid, floorGrid);
    floorGeometry.attributes.position.usage = THREE.DynamicDrawUsage;

    const floorMaterial = new THREE.MeshStandardMaterial({
        map: groundBaseColor,
        normalMap: groundNormal,
        roughnessMap: groundRoughness,
        roughness: 1,
        metalness: 0
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Texturas para a camada de Terra (Dirt)
    const dirtColor = groundLoader.load('textura-terra/terra-paint/Ground103_2K-JPG_Color.jpg');
    const dirtNormal = groundLoader.load('textura-terra/terra-paint/Ground103_2K-JPG_NormalGL.jpg');
    const dirtRoughness = groundLoader.load('textura-terra/terra-paint/Ground103_2K-JPG_Roughness.jpg');

    [dirtColor, dirtNormal, dirtRoughness].forEach(t => {
        if (t) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            t.anisotropy = maxAnisotropy;
            t.colorSpace = THREE.SRGBColorSpace;
        }
    });

    // Splatmap de Terra (Dirt)
    splatCanvas = document.createElement('canvas');
    splatCanvas.width = 1024;
    splatCanvas.height = 1024;
    splatCtx = splatCanvas.getContext('2d');
    splatCtx.fillStyle = '#000000';
    splatCtx.fillRect(0, 0, 1024, 1024);
    splatTexture = new THREE.CanvasTexture(splatCanvas);
    splatTexture.colorSpace = THREE.NoColorSpace;

    // ROCK PAINT LAYER (Relevo)
    const rockColor = groundLoader.load('textura-terra/txet-relevo/Rock058_1K-JPG_Color.jpg');
    const rockNormal = groundLoader.load('textura-terra/txet-relevo/Rock058_1K-JPG_NormalGL.jpg');
    const rockRoughness = groundLoader.load('textura-terra/txet-relevo/Rock058_1K-JPG_Roughness.jpg');

    [rockColor, rockNormal, rockRoughness].forEach(t => {
        if (t) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            t.anisotropy = maxAnisotropy;
            t.colorSpace = THREE.SRGBColorSpace;
        }
    });

    // Canvas para Splatmap de Rocha (Automático no Relevo)
    rockSplatCanvas = document.createElement('canvas');
    rockSplatCanvas.width = 1024;
    rockSplatCanvas.height = 1024;
    rockSplatCtx = rockSplatCanvas.getContext('2d');
    rockSplatCtx.fillStyle = '#000000';
    rockSplatCtx.fillRect(0, 0, 1024, 1024);
    rockSplatTexture = new THREE.CanvasTexture(rockSplatCanvas);
    rockSplatTexture.colorSpace = THREE.NoColorSpace;

    const rockMaterial = new THREE.MeshStandardMaterial({
        map: rockColor,
        normalMap: rockNormal,
        roughnessMap: rockRoughness,
        roughness: 1,
        metalness: 0,
        alphaMap: rockSplatTexture,
        transparent: true,
        alphaTest: 0.1
    });

    const rockFloor = new THREE.Mesh(floorGeometry, rockMaterial);
    rockFloor.rotation.x = -Math.PI / 2;
    rockFloor.position.y = 0.02; // Um pouco mais acima
    rockFloor.receiveShadow = true;
    scene.add(rockFloor);

    // --- CAMADA DE GRAMA SOLO ---
    grassSplatCanvas = document.createElement('canvas');
    grassSplatCanvas.width = 1024;
    grassSplatCanvas.height = 1024;
    grassSplatCtx = grassSplatCanvas.getContext('2d');
    grassSplatCtx.fillStyle = '#000000';
    grassSplatCtx.fillRect(0, 0, 1024, 1024);
    grassSplatTexture = new THREE.CanvasTexture(grassSplatCanvas);
    grassSplatTexture.colorSpace = THREE.NoColorSpace;

    // --- CAMADA DE FLORA EXTRA ---
    floraSplatCanvas = document.createElement('canvas');
    floraSplatCanvas.width = 1024;
    floraSplatCanvas.height = 1024;
    floraSplatCtx = floraSplatCanvas.getContext('2d');
    floraSplatCtx.fillStyle = '#000000';
    floraSplatCtx.fillRect(0, 0, 1024, 1024);
    floraSplatTexture = new THREE.CanvasTexture(floraSplatCanvas);
    floraSplatTexture.colorSpace = THREE.NoColorSpace;

    const floraColor = groundLoader.load('textura-terra/low/Group 169.png');
    floraColor.wrapS = THREE.RepeatWrapping;
    floraColor.wrapT = THREE.RepeatWrapping;
    floraColor.repeat.set(repeatX, repeatY);
    floraColor.anisotropy = maxAnisotropy;
    floraColor.colorSpace = THREE.SRGBColorSpace;

    const floraMaterial = new THREE.MeshStandardMaterial({
        map: floraColor,
        roughness: 1,
        metalness: 0,
        alphaMap: floraSplatTexture,
        transparent: true,
        alphaTest: 0.1
    });

    const floraFloor = new THREE.Mesh(floorGeometry, floraMaterial);
    floraFloor.rotation.x = -Math.PI / 2;
    floraFloor.position.y = 0.012; // Entre terra (0.01) e grama solo (0.015)
    floraFloor.receiveShadow = true;
    scene.add(floraFloor);

    // Expõe para uso global no editor (agora com todas as camadas inicializadas)
    window.terrainCanvases = {
        splat: { canvas: splatCanvas, ctx: splatCtx, tex: splatTexture },
        rock: { canvas: rockSplatCanvas, ctx: rockSplatCtx, tex: rockSplatTexture },
        grass: { canvas: grassSplatCanvas, ctx: grassSplatCtx, tex: grassSplatTexture },
        flora: { canvas: floraSplatCanvas, ctx: floraSplatCtx, tex: floraSplatTexture }
    };

    const dirtMaterial = new THREE.MeshStandardMaterial({
        map: dirtColor,
        normalMap: dirtNormal,
        roughnessMap: dirtRoughness,
        roughness: 1,
        metalness: 0,
        alphaMap: splatTexture,
        transparent: true,
        alphaTest: 0.1
    });

    dirtFloor = new THREE.Mesh(floorGeometry, dirtMaterial);
    dirtFloor.rotation.x = -Math.PI / 2;
    dirtFloor.position.y = 0.01; // Levemente acima para evitar z-fighting
    dirtFloor.receiveShadow = true;
    scene.add(dirtFloor);

    // --- CAMADA DE GRAMA SOLO (horiginal) ---
    const grassSoloColor = groundLoader.load('textura-terra/horiginal/Grass008_1K-JPG_Color.jpg');
    const grassSoloNormal = groundLoader.load('textura-terra/horiginal/Grass008_1K-JPG_NormalGL.jpg');
    const grassSoloRoughness = groundLoader.load('textura-terra/horiginal/Grass008_1K-JPG_Roughness.jpg');

    [grassSoloColor, grassSoloNormal, grassSoloRoughness].forEach(t => {
        if (t) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            t.anisotropy = maxAnisotropy;
            t.colorSpace = THREE.SRGBColorSpace;
        }
    });



    const grassSoloMaterial = new THREE.MeshStandardMaterial({
        map: grassSoloColor,
        normalMap: grassSoloNormal,
        roughnessMap: grassSoloRoughness,
        roughness: 1,
        metalness: 0,
        alphaMap: grassSplatTexture,
        transparent: true,
        alphaTest: 0.1
    });

    const grassSoloFloor = new THREE.Mesh(floorGeometry, grassSoloMaterial);
    grassSoloFloor.rotation.x = -Math.PI / 2;
    grassSoloFloor.position.y = 0.015; // Entre terra (0.01) e rocha (0.02)
    grassSoloFloor.receiveShadow = true;
    scene.add(grassSoloFloor);



    // Orbit Controls (Câmera Livre)
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.05;

    // Criando a geometria do Sprite da Grama (Billboards Cruzados)
    const plane1 = new THREE.PlaneGeometry(1, 1);
    plane1.translate(0, 0.5, 0); // Pivô na base
    const plane2 = plane1.clone();
    plane2.rotateY(Math.PI / 2);

    // Une os dois planos para formar a "Cruz" clássica de mato 3D
    const grassGeometry = BufferGeometryUtils.mergeGeometries([plane1, plane2]);

    // Carrega a textura do usuário e aplica
    const grassTextureLoader = new THREE.TextureLoader();
    grassTextureLoader.load('textura-terra/Group 166.png', (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;

        const grassMaterial = new THREE.MeshToonMaterial({
            map: texture,
            gradientMap: toonRamp,
            transparent: true,
            alphaTest: 0.5, // Ignora o fundo transparente da imagem
            side: THREE.DoubleSide
        });

        // Injetar Lógica de Vento (Shader)
        grassMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = grassUniforms.uTime;
            shader.vertexShader = `
                uniform float uTime;
            ` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                #include <begin_vertex>
                
                // worldPosition para que o vento varie conforme o lugar do mapa
                vec4 worldPos = instanceMatrix * vec4(transformed, 1.0);
                
                // Efeito de balanço sutil (Apenas se a altura Y for maior que 0.1)
                float windX = sin(uTime * 2.0 + worldPos.x * 0.5 + worldPos.z * 0.3) * position.y * 0.15;
                float windZ = cos(uTime * 1.5 + worldPos.x * 0.2 + worldPos.z * 0.5) * position.y * 0.1;
                
                transformed.x += windX;
                transformed.z += windZ;
                `
            );
        };

        // Um único InstancedMesh agora suporta O DOBRO do limite com muita facilidade!
        const iMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, MAX_GRASS);
        iMesh.castShadow = true;
        iMesh.receiveShadow = true;
        iMesh.count = 0; // Inicia vazio
        iMesh.frustumCulled = false;

        // A matriz local vira a Identidade
        iMesh.userData = { localMatrix: new THREE.Matrix4() };

        // Hidrata caso o mapa já tenha trazido folhagens no carregamento
        if (editorGrassMatrices.length > 0) {
            const dummy = new THREE.Object3D();
            editorGrassMatrices.forEach((grass, index) => {
                if (index < MAX_GRASS) {
                    dummy.position.set(grass.position.x, grass.position.y, grass.position.z);
                    dummy.rotation.set(grass.rotation.x, grass.rotation.y, grass.rotation.z);
                    dummy.scale.set(grass.scale.x, grass.scale.y, grass.scale.z);
                    dummy.updateMatrixWorld(true);

                    const finalMatrix = new THREE.Matrix4();
                    finalMatrix.multiplyMatrices(dummy.matrixWorld, iMesh.userData.localMatrix);
                    iMesh.setMatrixAt(index, finalMatrix);
                }
            });
            iMesh.count = Math.min(editorGrassMatrices.length, MAX_GRASS);
            iMesh.instanceMatrix.needsUpdate = true;
        }

        scene.add(iMesh);
        editorGrassInstancedMeshes.push(iMesh);
    });

    // Transform Controls (Eixos de Movimentação do Blender)
    transformControl = new TransformControls(camera, renderer.domElement);

    transformControl.addEventListener('dragging-changed', function (event) {
        // Desativa a rotação da câmera quando você esbarrar numa Seta do Transform
        orbit.enabled = !event.value;
    });

    // Rastreia se estamos ativamente arrastando/apertando a seta para não bugar a seleção do Raycast
    transformControl.addEventListener('mouseDown', () => { isTransforming = true; });
    transformControl.addEventListener('mouseUp', () => { isTransforming = false; });

    scene.add(transformControl);

    // Botões da Tela (Modos)
    const paintTools = document.getElementById('paint-tools');
    const brushSizeSlider = document.getElementById('brush-size');
    const brushSizeVal = document.getElementById('brush-size-val');

    function updateButtonStyles(mode) {
        [btnTranslate, btnRotate, btnScale, btnPaint].forEach(btn => btn?.classList.remove('active-btn'));
        if (mode === 'translate') btnTranslate?.classList.add('active-btn');
        if (mode === 'rotate') btnRotate?.classList.add('active-btn');
        if (mode === 'scale') btnScale?.classList.add('active-btn');
        if (mode === 'paint') btnPaint?.classList.add('active-btn');

        if (paintTools) paintTools.style.display = (mode === 'paint') ? 'flex' : 'none';
        currentMode = (mode === 'paint') ? 'paint' : 'transform';

        if (currentMode === 'paint') {
            transformControl.detach();
            let modeName = 'Terra';
            if (brushTextureId === 'grama') modeName = 'Folhagem';
            if (brushTextureId === 'grama-solo') modeName = 'Grama';
            if (brushTextureId === 'flora') modeName = 'Flora Extra';
            if (brushTextureId === 'relevo') modeName = 'Esculpir';

            selectedNameSpan.innerText = 'Modo Pintura (' + modeName + ')';
            orbit.enabled = false; // Desativa a rotação para arrastar pincel sem bugar
        } else {
            orbit.enabled = true;
        }
    }

    if (brushSizeSlider) {
        brushSizeSlider.addEventListener('input', (e) => {
            brushSize = parseInt(e.target.value);
            if (brushSizeVal) brushSizeVal.innerText = brushSize;
        });
    }

    const foliageScaleSlider = document.getElementById('foliage-scale');
    const foliageScaleVal = document.getElementById('foliage-scale-val');
    if (foliageScaleSlider) {
        foliageScaleSlider.addEventListener('input', (e) => {
            brushFoliageScale = parseFloat(e.target.value);
            if (foliageScaleVal) foliageScaleVal.innerText = brushFoliageScale.toFixed(1);
        });
    }

    const sculptStrengthSlider = document.getElementById('sculpt-strength');
    const sculptStrengthVal = document.getElementById('sculpt-strength-val');
    if (sculptStrengthSlider) {
        sculptStrengthSlider.addEventListener('input', (e) => {
            sculptStrength = parseFloat(e.target.value);
            if (sculptStrengthVal) sculptStrengthVal.innerText = sculptStrength.toFixed(1);
        });
    }

    const btnBrushTerra = document.getElementById('btn-brush-terra');
    const btnBrushGramaSolo = document.getElementById('btn-brush-grama-solo');
    const btnBrushFlora = document.getElementById('btn-brush-flora');
    const btnBrushGrama = document.getElementById('btn-brush-grama');
    const btnBrushRelevo = document.getElementById('btn-brush-relevo');
    if (btnBrushTerra && btnBrushGramaSolo && btnBrushFlora && btnBrushGrama && btnBrushRelevo) {
        btnBrushTerra.addEventListener('click', () => {
            brushTextureId = 'terra';
            btnBrushTerra.style.borderColor = '#4CAF50';
            btnBrushGramaSolo.style.borderColor = 'transparent';
            btnBrushFlora.style.borderColor = 'transparent';
            btnBrushGrama.style.borderColor = 'transparent';
            btnBrushRelevo.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Terra)';
        });
        btnBrushGramaSolo.addEventListener('click', () => {
            brushTextureId = 'grama-solo';
            btnBrushGramaSolo.style.borderColor = '#4CAF50';
            btnBrushTerra.style.borderColor = 'transparent';
            btnBrushFlora.style.borderColor = 'transparent';
            btnBrushGrama.style.borderColor = 'transparent';
            btnBrushRelevo.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Grama)';
        });
        btnBrushFlora.addEventListener('click', () => {
            brushTextureId = 'flora';
            btnBrushFlora.style.borderColor = '#4CAF50';
            btnBrushTerra.style.borderColor = 'transparent';
            btnBrushGramaSolo.style.borderColor = 'transparent';
            btnBrushGrama.style.borderColor = 'transparent';
            btnBrushRelevo.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Flora Extra)';
        });
        btnBrushGrama.addEventListener('click', () => {
            brushTextureId = 'grama';
            btnBrushGrama.style.borderColor = '#4CAF50';
            btnBrushTerra.style.borderColor = 'transparent';
            btnBrushGramaSolo.style.borderColor = 'transparent';
            btnBrushFlora.style.borderColor = 'transparent';
            btnBrushRelevo.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Folhagem)';
        });
        btnBrushRelevo.addEventListener('click', () => {
            brushTextureId = 'relevo';
            btnBrushRelevo.style.borderColor = '#4CAF50';
            btnBrushTerra.style.borderColor = 'transparent';
            btnBrushGramaSolo.style.borderColor = 'transparent';
            btnBrushFlora.style.borderColor = 'transparent';
            btnBrushGrama.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Relevo (⛰️ Esculpir)';
        });
    }

    btnTranslate?.addEventListener('click', () => { transformControl.setMode('translate'); updateButtonStyles('translate'); });
    btnRotate?.addEventListener('click', () => { transformControl.setMode('rotate'); updateButtonStyles('rotate'); });
    btnScale?.addEventListener('click', () => { transformControl.setMode('scale'); updateButtonStyles('scale'); });
    btnPaint?.addEventListener('click', () => updateButtonStyles('paint'));

    // Botão Apagar
    const btnEraser = document.getElementById('btn-eraser');
    if (btnEraser) {
        btnEraser.addEventListener('click', () => {
            isErasing = !isErasing;
            if (isErasing) {
                btnEraser.style.background = '#7f1d1d';
                btnEraser.style.borderColor = '#ff4444';
                btnEraser.style.color = '#ffaaaa';
                btnEraser.style.boxShadow = '0 0 12px rgba(255, 68, 68, 0.5)';
                btnEraser.innerText = '🧹 Apagando...';
                selectedNameSpan.innerText = 'Modo Apagar (' + brushTextureId + ')';
            } else {
                btnEraser.style.background = '#3a2a2a';
                btnEraser.style.borderColor = 'rgba(255,100,100,0.2)';
                btnEraser.style.color = '#ff9090';
                btnEraser.style.boxShadow = 'none';
                btnEraser.innerHTML = '<span>🧹</span> Apagar';
                selectedNameSpan.innerText = 'Modo Pintura (' + brushTextureId + ')';
            }
        });
    }

    window.addEventListener('keydown', function (event) {
        switch (event.key.toLowerCase()) {
            case 'w': transformControl.setMode('translate'); updateButtonStyles('translate'); break;
            case 'e': transformControl.setMode('rotate'); updateButtonStyles('rotate'); break;
            case 'r': transformControl.setMode('scale'); updateButtonStyles('scale'); break;
            case 'g': updateButtonStyles('paint'); break;
            case 'delete':
                if (transformControl.object) {
                    const obj = transformControl.object;
                    if (typeof undoStack !== 'undefined') undoStack.push({ type: 'remove', object: obj });
                    transformControl.detach();
                    scene.remove(obj);
                    const index = objectsToIntersect.indexOf(obj);
                    if (index > -1) objectsToIntersect.splice(index, 1);
                    selectedNameSpan.innerText = 'Nenhum';
                }
                break;
        }
    });

    // Sistema de Desfazer (Undo)
    const undoStack = [];
    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            const lastAction = undoStack.pop();
            if (!lastAction) return;
            if (lastAction.type === 'grass-stroke') {
                if (editorGrassInstancedMeshes.length > 0 && lastAction.count > 0) {
                    editorGrassInstancedMeshes.forEach(iMesh => {
                        iMesh.count -= lastAction.count;
                        if (iMesh.count < 0) iMesh.count = 0;
                        iMesh.instanceMatrix.needsUpdate = true;
                    });
                    editorGrassMatrices.splice(-lastAction.count);
                }
            } else if (lastAction.type === 'add') {
                if (transformControl.object === lastAction.object) {
                    transformControl.detach();
                    selectedNameSpan.innerText = 'Nenhum';
                }
                scene.remove(lastAction.object);
                const index = objectsToIntersect.indexOf(lastAction.object);
                if (index > -1) objectsToIntersect.splice(index, 1);
            } else if (lastAction.type === 'remove') {
                scene.add(lastAction.object);
                objectsToIntersect.push(lastAction.object);
            }
        });
    }

    // Lógica da Livraria de Modelos (Spawn)
    const btnSpawnCroaker = document.getElementById('btn-spawn-croaker');
    const btnSpawnTree1 = document.getElementById('btn-spawn-tree1');
    const btnSpawnTreeNew = document.getElementById('btn-spawn-tree-new');
    let astCount = 0;
    let sapoCount = 0;
    let predioCount = 0;

    if (btnSpawnTreeNew) {
        btnSpawnTreeNew.addEventListener('click', () => {
            const originalText = btnSpawnTreeNew.innerText;
            btnSpawnTreeNew.innerText = '⏳ Carregando...';
            btnSpawnTreeNew.disabled = true;

            const fbxLoader = new FBXLoader();
            fbxLoader.load('arvore/Untitled.fbx', (model) => {
                astCount++;

                // Aplica melhorias visuais (Alpha Cutout, DoubleSide, SRGB)
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            const oldMat = child.material;
                            const isLeaf = (oldMat.map || oldMat.name.toLowerCase().includes('folha') || oldMat.name.toLowerCase().includes('leaf'));

                            if (oldMat.map) oldMat.map.colorSpace = THREE.SRGBColorSpace;

                            const newMat = new THREE.MeshStandardMaterial({
                                map: oldMat.map,
                                color: oldMat.color,
                                transparent: isLeaf,
                                alphaTest: isLeaf ? 0.5 : 0.0,
                                side: THREE.DoubleSide,
                                roughness: 1.0,
                                metalness: 0.0
                            });
                            child.material = newMat;

                            if (isLeaf) {
                                child.scale.multiplyScalar(1.3);
                            }
                        }
                    }
                });

                // Modelos FBX costumam precisar de ajuste de escala
                model.scale.set(0.01, 0.01, 0.01);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'arvore/Untitled.fbx', format: 'fbx' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Nova Árvore (${astCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnTreeNew.innerText = originalText;
                btnSpawnTreeNew.disabled = false;
            }, undefined, (error) => {
                alert("Erro ao ler FBX: " + error.message);
                btnSpawnTreeNew.innerText = originalText;
                btnSpawnTreeNew.disabled = false;
            });
        });
    }

    if (btnSpawnTree1) {
        btnSpawnTree1.addEventListener('click', () => {
            const originalText = btnSpawnTree1.innerText;
            btnSpawnTree1.innerText = '⏳ Carregando...';
            btnSpawnTree1.disabled = true;

            const gltfLoader = new GLTFLoader();
            gltfLoader.load('arvore/Meshy_AI__0416041346_texture.glb', (gltf) => {
                astCount++;
                const model = gltf.scene;

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            const oldMat = child.material;
                            const isLeaf = (oldMat.map || oldMat.name.toLowerCase().includes('folha') || oldMat.name.toLowerCase().includes('leaf'));
                            const newMat = new THREE.MeshToonMaterial({
                                map: oldMat.map,
                                gradientMap: toonRamp,
                                color: oldMat.color,
                                transparent: false,
                                alphaTest: 0.15,
                                side: THREE.DoubleSide
                            });
                            child.material = newMat;
                            child.material.roughness = 1.0;

                            if (isLeaf || child.name.toLowerCase().includes('folha') || child.name.toLowerCase().includes('leaf')) {
                                child.scale.multiplyScalar(1.6);
                            }
                        }
                    }
                });

                model.scale.set(1, 1, 1);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'arvore/Meshy_AI__0416041346_texture.glb', format: 'glb' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Árvore (Meshy) (${astCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnTree1.innerText = originalText;
                btnSpawnTree1.disabled = false;
            }, undefined, (error) => {
                alert("Erro ao ler GLB: " + error.message);
                btnSpawnTree1.innerText = originalText;
                btnSpawnTree1.disabled = false;
            });
        });
    }

    if (btnSpawnCroaker) {
        btnSpawnCroaker.addEventListener('click', () => {
            const originalText = btnSpawnCroaker.innerText;
            btnSpawnCroaker.innerText = '⏳ Baixando FBX...';
            btnSpawnCroaker.disabled = true;

            const fbxLoader = new FBXLoader();
            fbxLoader.load('perssongem/Meshy_AI_Captain_Croaker_0415164703_texture.fbx', (model) => {
                sapoCount++;

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });

                // Modelos FBX brutos costumam vir gigantes (Escala 100), então deixo pequeno e o usuário aumenta com a Escala (R)
                model.scale.set(0.01, 0.01, 0.01);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'perssongem/Meshy_AI_Captain_Croaker_0415164703_texture.fbx', format: 'fbx' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Sapo (${sapoCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                // Seleciona o sapo recém-criado automaticamente
                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnCroaker.innerText = originalText;
                btnSpawnCroaker.disabled = false;
            }, undefined, (error) => {
                alert("Erro ao ler FBX: " + error.message);
                btnSpawnCroaker.innerText = originalText;
                btnSpawnCroaker.disabled = false;
            });
        });
    }

    const btnSpawnPredio = document.getElementById('btn-spawn-predio');
    if (btnSpawnPredio) {
        btnSpawnPredio.addEventListener('click', () => {
            const originalText = btnSpawnPredio.innerText;
            btnSpawnPredio.innerText = '⏳ Carregando...';
            btnSpawnPredio.disabled = true;

            const gltfLoader = new THREE.GLTFLoader ? new THREE.GLTFLoader() : new GLTFLoader();
            gltfLoader.load('cidade/predio.glb', (gltf) => {
                predioCount++;
                const model = gltf.scene;

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.roughness = 1.0;
                            child.material.metalness = 0.0;
                        }
                    }
                });

                model.scale.set(1, 1, 1);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'cidade/predio.glb', format: 'glb' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Prédio (${predioCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnPredio.innerText = originalText;
                btnSpawnPredio.disabled = false;
            }, undefined, (error) => {
                alert("Erro ao ler GLB: " + error.message);
                btnSpawnPredio.innerText = originalText;
                btnSpawnPredio.disabled = false;
            });
        });
    }

    const btnSpawnPedra = document.getElementById('btn-spawn-pedra');
    let pedraCount = 0;
    if (btnSpawnPedra) {
        btnSpawnPedra.addEventListener('click', () => {
            const originalText = btnSpawnPedra.innerText;
            btnSpawnPedra.innerText = '⏳ Carregando...';
            btnSpawnPedra.disabled = true;

            const gltfLoader = new GLTFLoader();
            gltfLoader.load('pedra/Untitled.glb', (gltf) => {
                pedraCount++;
                const model = gltf.scene;

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.roughness = 1.0;
                            child.material.metalness = 0.0;
                        }
                    }
                });

                model.scale.set(1, 1, 1);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'pedra/Untitled.glb', format: 'glb' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Pedra (${pedraCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnPedra.innerText = originalText;
                btnSpawnPedra.disabled = false;
            }, undefined, (error) => {
                alert('Erro ao ler GLB da pedra: ' + error.message);
                btnSpawnPedra.innerText = originalText;
                btnSpawnPedra.disabled = false;
            });
        });
    }

    const btnSpawnMoto = document.getElementById('btn-spawn-moto');
    let motoCount = 0;
    if (btnSpawnMoto) {
        btnSpawnMoto.addEventListener('click', () => {
            const originalText = btnSpawnMoto.innerText;
            btnSpawnMoto.innerText = '⏳ Carregando...';
            btnSpawnMoto.disabled = true;

            const gltfLoader = new GLTFLoader();
            gltfLoader.load('modelos/Meshy_AI_moto_0418191351_texture.glb', (gltf) => {
                motoCount++;
                const model = gltf.scene;

                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            child.material.roughness = 0.8;
                            child.material.metalness = 0.3;
                        }
                    }
                });

                model.scale.set(1, 1, 1);

                const spawnGroup = new THREE.Group();
                spawnGroup.userData = { isMapEditorObject: true, url: 'modelos/Meshy_AI_moto_0418191351_texture.glb', format: 'glb' };
                spawnGroup.position.set(0, 0, 0);
                spawnGroup.name = `Moto (${motoCount})`;
                spawnGroup.add(model);

                scene.add(spawnGroup);
                objectsToIntersect.push(spawnGroup);
                if (typeof undoStack !== 'undefined') undoStack.push({ type: 'add', object: spawnGroup });

                transformControl.attach(spawnGroup);
                selectedNameSpan.innerText = spawnGroup.name;

                btnSpawnMoto.innerText = originalText;
                btnSpawnMoto.disabled = false;
            }, undefined, (error) => {
                alert('Erro ao ler GLB da moto: ' + error.message);
                btnSpawnMoto.innerText = originalText;
                btnSpawnMoto.disabled = false;
            });
        });
    }

    // Lógica de Salvar Cenário JSON
    const btnSaveMap = document.getElementById('btn-save-map');
    if (btnSaveMap) {
        btnSaveMap.addEventListener('click', async () => {
            const payloadObjects = [];
            objectsToIntersect.forEach(obj => {
                if (obj.userData && obj.userData.isMapEditorObject) {
                    payloadObjects.push({
                        url: obj.userData.url,
                        format: obj.userData.format,
                        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
                    });
                }
            });

            // Agrega a matriz completa de texturas e posições passadas pelo pincel em 3D
            editorGrassMatrices.forEach(grass => {
                payloadObjects.push({
                    url: 'grama_sprite',
                    format: 'sprite',
                    position: grass.position,
                    rotation: grass.rotation,
                    scale: grass.scale
                });
            });

            // Converte Canvases para base 64 leve
            const splatData = splatCanvas.toDataURL('image/png');
            const rockSplatData = window.terrainCanvases.rock.canvas.toDataURL('image/png');
            const grassSplatData = window.terrainCanvases.grass.canvas.toDataURL('image/png');
            const floraSplatData = window.terrainCanvases.flora.canvas.toDataURL('image/png');

            // Extrai alturas atuais para salvar
            const posAttr = floor.geometry.attributes.position;
            const heights = [];
            for (let i = 0; i < posAttr.count; i++) {
                heights.push(parseFloat(posAttr.getZ(i).toFixed(3)));
            }

            const payloadConfig = {
                objects: payloadObjects,
                splatmap: splatData,
                rockSplatmap: rockSplatData,
                grassSplatmap: grassSplatData,
                floraSplatmap: floraSplatData,
                heightData: heights
            };

            btnSaveMap.innerText = 'Salvando...';
            try {
                const res = await fetch('/save-map', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadConfig)
                });
                if (res.ok) {
                    btnSaveMap.innerText = '✅ Salvo!';
                } else {
                    btnSaveMap.innerText = '❌ Erro ao salvar';
                }
            } catch (e) {
                alert('Servidor desconectado! ' + e.message);
                btnSaveMap.innerText = '💾 Salvar Cenário';
            }
            setTimeout(() => btnSaveMap.innerText = '💾 Salvar Cenário', 2500);
        });
    }

    // Carregar Cenário Existente no Editor
    fetch('/cenario.json')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (!data) return;
            const fbxLoader = new FBXLoader();
            const localGltfLoader = new GLTFLoader();

            let mapObjects = [];
            if (Array.isArray(data)) {
                mapObjects = data; // Backward compatibilidade
            } else {
                mapObjects = data.objects || [];
                // Load Splatmap
                if (data.splatmap && splatCtx) {
                    const img = new Image();
                    img.onload = () => {
                        splatCtx.drawImage(img, 0, 0);
                        splatTexture.needsUpdate = true;
                    };
                    img.src = data.splatmap;
                }
                if (data.rockSplatmap && window.terrainCanvases.rock) {
                    const img = new Image();
                    img.onload = () => {
                        window.terrainCanvases.rock.ctx.drawImage(img, 0, 0);
                        window.terrainCanvases.rock.tex.needsUpdate = true;
                    };
                    img.src = data.rockSplatmap;
                }
                if (data.grassSplatmap && window.terrainCanvases.grass) {
                    const img = new Image();
                    img.onload = () => {
                        window.terrainCanvases.grass.ctx.drawImage(img, 0, 0);
                        window.terrainCanvases.grass.tex.needsUpdate = true;
                    };
                    img.src = data.grassSplatmap;
                }
                if (data.floraSplatmap && window.terrainCanvases.flora) {
                    const img = new Image();
                    img.onload = () => {
                        window.terrainCanvases.flora.ctx.drawImage(img, 0, 0);
                        window.terrainCanvases.flora.tex.needsUpdate = true;
                    };
                    img.src = data.floraSplatmap;
                }
                if (data.heightData && floor.geometry) {
                    const posAttr = floor.geometry.attributes.position;
                    data.heightData.forEach((h, i) => {
                        if (i < posAttr.count) posAttr.setZ(i, h);
                    });
                    posAttr.needsUpdate = true;
                    floor.geometry.computeVertexNormals();
                }
            }

            mapObjects.forEach(item => {
                if (item.url && (item.url.includes('grama.fbx') || item.url === 'grama_sprite')) {
                    // Compatibilidade: se for mapa antigo que usava grama.fbx, converte para sprite nativo!
                    item.url = 'grama_sprite';
                    item.format = 'sprite';
                    editorGrassMatrices.push(item);
                } else if (item.format === 'fbx') {
                    fbxLoader.load(item.url, (model) => {
                        astCount++;
                        model.traverse((child) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                if (child.material) {
                                    const oldMat = child.material;
                                    const isLeaf = (oldMat.map || oldMat.name.toLowerCase().includes('folha') || oldMat.name.toLowerCase().includes('leaf'));
                                    const newMat = new THREE.MeshToonMaterial({
                                        map: oldMat.map,
                                        gradientMap: toonRamp,
                                        color: oldMat.color,
                                        transparent: false,
                                        alphaTest: 0.15,
                                        side: THREE.DoubleSide
                                    });
                                    child.material = newMat;
                                    child.material.roughness = 1.0;

                                    if (isLeaf || child.name.toLowerCase().includes('folha') || child.name.toLowerCase().includes('leaf')) {
                                        child.scale.multiplyScalar(1.6);
                                    }
                                }
                            }
                        });
                        model.scale.set(0.01, 0.01, 0.01);

                        const spawnGroup = new THREE.Group();
                        spawnGroup.userData = { isMapEditorObject: true, url: item.url, format: item.format };
                        spawnGroup.position.set(item.position.x, item.position.y, item.position.z);
                        spawnGroup.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                        spawnGroup.scale.set(item.scale.x, item.scale.y, item.scale.z);
                        const isTree = item.url.toLowerCase().includes('tree') || item.url.toLowerCase().includes('arvore');
                        spawnGroup.name = isTree ? `Árvore (${astCount})` : `Sapo (${astCount})`;
                        spawnGroup.add(model);

                        scene.add(spawnGroup);
                        objectsToIntersect.push(spawnGroup);
                    });
                } else if (item.format === 'glb') {
                    localGltfLoader.load(item.url, (gltf) => {
                        astCount++;
                        const model = gltf.scene;
                        model.traverse((child) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                if (child.material) {
                                    const oldMat = child.material;
                                    const isLeaf = (oldMat.map || oldMat.name.toLowerCase().includes('folha') || oldMat.name.toLowerCase().includes('leaf'));
                                    const newMat = new THREE.MeshToonMaterial({
                                        map: oldMat.map,
                                        gradientMap: toonRamp,
                                        color: oldMat.color,
                                        transparent: false,
                                        alphaTest: 0.15,
                                        side: THREE.DoubleSide
                                    });
                                    child.material = newMat;
                                    child.material.roughness = 1.0;

                                    if (isLeaf || child.name.toLowerCase().includes('folha') || child.name.toLowerCase().includes('leaf')) {
                                        child.scale.multiplyScalar(1.6);
                                    }
                                }
                            }
                        });
                        model.scale.set(1, 1, 1);

                        const spawnGroup = new THREE.Group();
                        spawnGroup.userData = { isMapEditorObject: true, url: item.url, format: item.format };
                        spawnGroup.position.set(item.position.x, item.position.y, item.position.z);
                        spawnGroup.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                        spawnGroup.scale.set(item.scale.x, item.scale.y, item.scale.z);
                        spawnGroup.name = `Objeto (${astCount})`;
                        spawnGroup.add(model);

                        scene.add(spawnGroup);
                        objectsToIntersect.push(spawnGroup);
                    });
                }
            });

            // Resolvendo Race Condition: Se a malha já foi criada antes do JSON chegar, Injetamos agora!
            if (editorGrassInstancedMeshes.length > 0 && editorGrassMatrices.length > 0) {
                const iMesh = editorGrassInstancedMeshes[0];
                const dummy = new THREE.Object3D();
                editorGrassMatrices.forEach((grass, index) => {
                    if (index < MAX_GRASS) {
                        dummy.position.set(grass.position.x, grass.position.y, grass.position.z);
                        dummy.rotation.set(grass.rotation.x, grass.rotation.y, grass.rotation.z);
                        dummy.scale.set(grass.scale.x, grass.scale.y, grass.scale.z);
                        dummy.updateMatrixWorld(true);

                        const finalMatrix = new THREE.Matrix4();
                        finalMatrix.multiplyMatrices(dummy.matrixWorld, iMesh.userData.localMatrix);
                        iMesh.setMatrixAt(index, finalMatrix);
                    }
                });
                iMesh.count = Math.min(editorGrassMatrices.length, MAX_GRASS);
                iMesh.instanceMatrix.needsUpdate = true;
            }

        }).catch(err => console.log("Sem cenario anterior", err));

    // Load Fox
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Idle_5_withSkin.glb', (gltf) => {
        const model = gltf.scene;
        const outlines = [];
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Toon Material for Cel Shading (Personagem)
                if (child.material) {
                    const oldMat = child.material;
                    child.material = new THREE.MeshToonMaterial({
                        map: oldMat.map,
                        gradientMap: toonRamp,
                        color: oldMat.color,
                        transparent: oldMat.transparent,
                        alphaTest: oldMat.alphaTest,
                        side: oldMat.side
                    });

                    const outlineMesh = child.clone();
                    outlineMesh.material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
                    outlineMesh.scale.multiplyScalar(1.02);
                    outlines.push({ parent: child, mesh: outlineMesh });
                }
            }
        });
        outlines.forEach(item => item.parent.add(item.mesh));

        const playerModel = new THREE.Group();
        playerModel.position.set(0, 0, 0);
        playerModel.rotation.y = Math.PI;
        playerModel.name = "Raposa";
        playerModel.add(model);
        scene.add(playerModel);

        // Cadastra para o Laser Raycaster poder clicar
        objectsToIntersect.push(playerModel);

        const playerMixer = new THREE.AnimationMixer(model);
        if (gltf.animations && gltf.animations.length > 0) {
            const idleAction = playerMixer.clipAction(gltf.animations[0]);
            idleAction.play();
        }
        mixers.push(playerMixer);
    });

    // Raycaster (Para dar clique nos objetos)
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', (e) => {
        if (currentMode === 'paint') {
            isPainting = true;
            if (brushTextureId === 'grama' && typeof undoStack !== 'undefined') {
                undoStack.push({ type: 'grass-stroke', count: 0 }); // Inicia traço vazio
            }
            paintAtMouse(e);
        } else {
            onPointerDown(e);
        }
    });

    renderer.domElement.addEventListener('pointermove', (e) => {
        if (isPainting && currentMode === 'paint') {
            paintAtMouse(e);
        }
    });
    renderer.domElement.addEventListener('pointerup', () => {
        isPainting = false;
        if (currentMode === 'paint') orbit.enabled = true;
    });

    window.addEventListener('resize', onWindowResize);
}

function paintAtMouse(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(floor);

    if (intersects.length > 0) {
        const p = intersects[0].point;

        // --- MODO APAGAR ---
        if (isErasing) {
            if (brushTextureId === 'grama') {
                // Apaga grama 3D: remove instâncias dentro do raio do pincel
                const eraseRadius = brushSize / 20;
                const before = editorGrassMatrices.length;
                editorGrassMatrices = editorGrassMatrices.filter(g => {
                    const dx = g.position.x - p.x;
                    const dz = g.position.z - p.z;
                    return Math.sqrt(dx * dx + dz * dz) > eraseRadius;
                });

                // Reconstrói o InstancedMesh com as restantes
                if (editorGrassMatrices.length !== before && editorGrassInstancedMeshes.length > 0) {
                    const iMesh = editorGrassInstancedMeshes[0];
                    const dummy = new THREE.Object3D();
                    editorGrassMatrices.forEach((grass, index) => {
                        dummy.position.set(grass.position.x, grass.position.y, grass.position.z);
                        dummy.rotation.set(grass.rotation.x, grass.rotation.y, grass.rotation.z);
                        dummy.scale.set(grass.scale.x, grass.scale.y, grass.scale.z);
                        dummy.updateMatrixWorld(true);
                        const finalMatrix = new THREE.Matrix4();
                        finalMatrix.multiplyMatrices(dummy.matrixWorld, iMesh.userData.localMatrix);
                        iMesh.setMatrixAt(index, finalMatrix);
                    });
                    iMesh.count = editorGrassMatrices.length;
                    iMesh.instanceMatrix.needsUpdate = true;
                }
            } else if (brushTextureId !== 'relevo') {
                // Apaga a camada de splatmap selecionada
                const uv = intersects[0].uv;
                const x = uv.x * 1024;
                const y = (1 - uv.y) * 1024;
                let targetCtx = null;
                let targetTex = null;
                if (brushTextureId === 'terra')      { targetCtx = splatCtx;     targetTex = splatTexture; }
                if (brushTextureId === 'grama-solo') { targetCtx = grassSplatCtx; targetTex = grassSplatTexture; }
                if (brushTextureId === 'flora')      { targetCtx = floraSplatCtx; targetTex = floraSplatTexture; }

                if (targetCtx && targetTex) {
                    const grad = targetCtx.createRadialGradient(x, y, 0, x, y, brushSize);
                    grad.addColorStop(0, 'rgba(0,0,0,1)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    targetCtx.globalCompositeOperation = 'destination-out';
                    targetCtx.fillStyle = grad;
                    targetCtx.beginPath();
                    targetCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                    targetCtx.fill();
                    targetCtx.globalCompositeOperation = 'source-over';
                    targetTex.needsUpdate = true;
                }
            }
            return; // Sai sem pintar
        }

        if (brushTextureId === 'relevo') {
            sculptTerrain(p);
            return;
        }

        const uv = intersects[0].uv;
        const x = uv.x * 1024;
        const y = (1 - uv.y) * 1024;

        if (brushTextureId === 'terra') {
            // 1. Pinta Terra
            splatCtx.globalCompositeOperation = 'source-over';
            const grad = splatCtx.createRadialGradient(x, y, 0, x, y, brushSize);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            splatCtx.fillStyle = grad;
            splatCtx.beginPath();
            splatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
            splatCtx.fill();
            splatTexture.needsUpdate = true;

            // 2. Apaga Rocha (para a terra que está por baixo aparecer)
            if (rockSplatCtx) {
                rockSplatCtx.globalCompositeOperation = 'destination-out';
                rockSplatCtx.fillStyle = grad; // Usa o mesmo gradiente
                rockSplatCtx.beginPath();
                rockSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                rockSplatCtx.fill();
                rockSplatTexture.needsUpdate = true;
            }
            // 3. Apaga Grama Solo
            if (grassSplatCtx) {
                grassSplatCtx.globalCompositeOperation = 'destination-out';
                grassSplatCtx.fillStyle = grad;
                grassSplatCtx.beginPath();
                grassSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                grassSplatCtx.fill();
                grassSplatTexture.needsUpdate = true;
            }
            // 4. Apaga Flora Extra
            if (floraSplatCtx) {
                floraSplatCtx.globalCompositeOperation = 'destination-out';
                floraSplatCtx.fillStyle = grad;
                floraSplatCtx.beginPath();
                floraSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                floraSplatCtx.fill();
                floraSplatTexture.needsUpdate = true;
            }
        } else if (brushTextureId === 'grama-solo') {
            // 1. Pinta Grama Solo
            grassSplatCtx.globalCompositeOperation = 'source-over';
            const grad = grassSplatCtx.createRadialGradient(x, y, 0, x, y, brushSize);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            grassSplatCtx.fillStyle = grad;
            grassSplatCtx.beginPath();
            grassSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
            grassSplatCtx.fill();
            grassSplatTexture.needsUpdate = true;

            // 2. Apaga Terra
            if (splatCtx) {
                splatCtx.globalCompositeOperation = 'destination-out';
                splatCtx.fillStyle = grad;
                splatCtx.beginPath();
                splatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                splatCtx.fill();
                splatTexture.needsUpdate = true;
            }
            // 3. Apaga Rocha
            if (rockSplatCtx) {
                rockSplatCtx.globalCompositeOperation = 'destination-out';
                rockSplatCtx.fillStyle = grad;
                rockSplatCtx.beginPath();
                rockSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                rockSplatCtx.fill();
                rockSplatTexture.needsUpdate = true;
            }
            // 4. Apaga Flora Extra
            if (floraSplatCtx) {
                floraSplatCtx.globalCompositeOperation = 'destination-out';
                floraSplatCtx.fillStyle = grad;
                floraSplatCtx.beginPath();
                floraSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                floraSplatCtx.fill();
                floraSplatTexture.needsUpdate = true;
            }
        } else if (brushTextureId === 'flora') {
            // 1. Pinta Flora
            floraSplatCtx.globalCompositeOperation = 'source-over';
            const grad = floraSplatCtx.createRadialGradient(x, y, 0, x, y, brushSize);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            floraSplatCtx.fillStyle = grad;
            floraSplatCtx.beginPath();
            floraSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
            floraSplatCtx.fill();
            floraSplatTexture.needsUpdate = true;

            // 2. Apaga Terra
            if (splatCtx) {
                splatCtx.globalCompositeOperation = 'destination-out';
                splatCtx.fillStyle = grad;
                splatCtx.beginPath();
                splatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                splatCtx.fill();
                splatTexture.needsUpdate = true;
            }
            // 3. Apaga Rocha
            if (rockSplatCtx) {
                rockSplatCtx.globalCompositeOperation = 'destination-out';
                rockSplatCtx.fillStyle = grad;
                rockSplatCtx.beginPath();
                rockSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                rockSplatCtx.fill();
                rockSplatTexture.needsUpdate = true;
            }
            // 4. Apaga Grama Solo
            if (grassSplatCtx) {
                grassSplatCtx.globalCompositeOperation = 'destination-out';
                grassSplatCtx.fillStyle = grad;
                grassSplatCtx.beginPath();
                grassSplatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                grassSplatCtx.fill();
                grassSplatTexture.needsUpdate = true;
            }
        } else if (brushTextureId === 'grama') {
            const grassQuantity = Math.floor(brushSize / 20) + 1;
            const radius = brushSize / 20;
            const dummy = new THREE.Object3D();

            let addedInThisTick = 0;
            for (let i = 0; i < grassQuantity; i++) {
                if (editorGrassInstancedMeshes[0].count >= MAX_GRASS) break;
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * radius;
                const dropX = p.x + Math.cos(angle) * r;
                const dropZ = p.z + Math.sin(angle) * r;
                const rotY = Math.random() * Math.PI * 2;
                const sc = (0.8 + Math.random() * 0.5) * brushFoliageScale;

                // Raycast vertical para achar a altura EXATA do terreno no ponto de spawn
                const dropY = getTerrainHeight(dropX, dropZ);

                dummy.position.set(dropX, dropY, dropZ);
                dummy.rotation.set(0, rotY, 0);
                dummy.scale.set(sc, sc, sc);
                dummy.updateMatrixWorld(true);

                const finalMatrix = new THREE.Matrix4();
                finalMatrix.multiplyMatrices(dummy.matrixWorld, editorGrassInstancedMeshes[0].userData.localMatrix);
                editorGrassInstancedMeshes[0].setMatrixAt(editorGrassInstancedMeshes[0].count, finalMatrix);

                editorGrassMatrices.push({
                    position: { x: dropX, y: dropY, z: dropZ },
                    rotation: { x: 0, y: rotY, z: 0 },
                    scale: { x: sc, y: sc, z: sc }
                });
                editorGrassInstancedMeshes[0].count++;
                addedInThisTick++;
            }

            if (addedInThisTick > 0) {
                editorGrassInstancedMeshes[0].instanceMatrix.needsUpdate = true;
                if (typeof undoStack !== 'undefined' && undoStack.length > 0) {
                    const lastStroke = undoStack[undoStack.length - 1];
                    if (lastStroke.type === 'grass-stroke') {
                        lastStroke.count += addedInThisTick;
                    }
                }
            }
        }
    }
}

function sculptTerrain(point) {
    const posAttr = floor.geometry.attributes.position;
    const radius = brushSize / 2;
    const intensity = sculptStrength;

    let modified = false;
    for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const dx = vx - point.x;
        const dz = vy - point.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < radius) {
            const falloff = 1.0 - (dist / radius);
            const currentZ = posAttr.getZ(i);
            posAttr.setZ(i, currentZ + (falloff * intensity));
            modified = true;
        }
    }

    if (modified) {
        posAttr.needsUpdate = true;
        floor.geometry.computeVertexNormals();

        const cx = ((point.x + 500) / 1000) * 1024;
        const cy = ((point.z + 500) / 1000) * 1024;
        const grad = rockSplatCtx.createRadialGradient(cx, cy, 0, cx, cy, brushSize);
        grad.addColorStop(0, 'rgba(255,255,255,0.4)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        // 1. Auto-Pintura de Rocha
        rockSplatCtx.globalCompositeOperation = 'source-over';
        rockSplatCtx.fillStyle = grad;
        rockSplatCtx.beginPath();
        rockSplatCtx.arc(cx, cy, brushSize, 0, Math.PI * 2);
        rockSplatCtx.fill();
        rockSplatTexture.needsUpdate = true;

        // 2. Apaga Terra (para a rocha dominar o relevo)
        if (splatCtx) {
            splatCtx.globalCompositeOperation = 'destination-out';
            splatCtx.fillStyle = grad;
            splatCtx.beginPath();
            splatCtx.arc(cx, cy, brushSize, 0, Math.PI * 2);
            splatCtx.fill();
            splatTexture.needsUpdate = true;
        }

        // 3. Apaga Grama Solo
        if (grassSplatCtx) {
            grassSplatCtx.globalCompositeOperation = 'destination-out';
            grassSplatCtx.fillStyle = grad;
            grassSplatCtx.beginPath();
            grassSplatCtx.arc(cx, cy, brushSize, 0, Math.PI * 2);
            grassSplatCtx.fill();
            grassSplatTexture.needsUpdate = true;
        }
    }
}

function onPointerDown(event) {
    if (event.button !== 0) return; // Apenas Botão Esquerdo

    // Se estiver segurando uma SETA, ignora
    if (isTransforming) return;

    // Lógica do Mouse Interno do Canvas
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Testa colisão do Laser com Tudo na Lista, olhando pros Filhos da Malha (recursive=true)
    const intersects = raycaster.intersectObjects(objectsToIntersect, true);

    if (intersects.length > 0) {
        let object = intersects[0].object;

        // Sobe na árvore até achar o "Pai" (o group) que colocamos em objectsToIntersect
        while (object.parent && !objectsToIntersect.includes(object)) {
            object = object.parent;
        }

        if (objectsToIntersect.includes(object)) {
            transformControl.attach(object);
            selectedNameSpan.innerText = object.name || 'Objeto Selecionado';
            return;
        }
    }

    // Se clicou no vazio, tira a seta
    transformControl.detach();
    selectedNameSpan.innerText = 'Nenhum';
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    // Atualiza tempo do vento (segundos)
    grassUniforms.uTime.value = elapsed;

    // Atualiza todos os mixers de animação (ex: Raposa no editor)
    mixers.forEach(m => m.update(delta));

    orbit.update(); // Necessário para Damping
    renderer.render(scene, camera);
}

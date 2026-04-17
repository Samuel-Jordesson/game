import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

let scene, camera, renderer, orbit, transformControl;
let raycaster, mouse;
const objectsToIntersect = [];
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
let isPainting = false;
let brushSize = 50;
let currentMode = 'transform'; // ou 'paint'
let brushTextureId = 'terra'; // 'terra' ou 'grama'
let brushFoliageScale = 1.0;

// --- Folhagem (Grass) System ---
let editorGrassModel = null;
let editorGrassInstancedMeshes = [];
let editorGrassMatrices = [];
const MAX_GRASS = 10000;
const grassUniforms = {
    uTime: { value: 0 }
};

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

    const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
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

    // TERRA PAINT LAYER (Nova Lógica de Pincel Oculta)
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

    splatCanvas = document.createElement('canvas');
    splatCanvas.width = 1024;
    splatCanvas.height = 1024;
    splatCtx = splatCanvas.getContext('2d');
    splatCtx.fillStyle = '#000000'; // Totalmente invisível/preto
    splatCtx.fillRect(0, 0, 1024, 1024);

    splatTexture = new THREE.CanvasTexture(splatCanvas);
    splatTexture.colorSpace = THREE.NoColorSpace; // Importante para Alpha
    splatTexture.minFilter = THREE.LinearFilter;
    splatTexture.magFilter = THREE.LinearFilter;

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
            selectedNameSpan.innerText = 'Modo Pintura (' + (brushTextureId === 'terra' ? 'Terra' : 'Grama') + ')';
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

    const btnBrushTerra = document.getElementById('btn-brush-terra');
    const btnBrushGrama = document.getElementById('btn-brush-grama');
    if (btnBrushTerra && btnBrushGrama) {
        btnBrushTerra.addEventListener('click', () => {
            brushTextureId = 'terra';
            btnBrushTerra.style.borderColor = '#4CAF50';
            btnBrushGrama.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Terra)';
        });
        btnBrushGrama.addEventListener('click', () => {
            brushTextureId = 'grama';
            btnBrushGrama.style.borderColor = '#4CAF50';
            btnBrushTerra.style.borderColor = 'transparent';
            if (currentMode === 'paint') selectedNameSpan.innerText = 'Modo Pintura (Grama)';
        });
    }

    btnTranslate?.addEventListener('click', () => { transformControl.setMode('translate'); updateButtonStyles('translate'); });
    btnRotate?.addEventListener('click', () => { transformControl.setMode('rotate'); updateButtonStyles('rotate'); });
    btnScale?.addEventListener('click', () => { transformControl.setMode('scale'); updateButtonStyles('scale'); });
    btnPaint?.addEventListener('click', () => updateButtonStyles('paint'));

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

            // Converte Canvas para base 64 leve
            const splatData = splatCanvas.toDataURL('image/png');

            const payloadConfig = {
                objects: payloadObjects,
                splatmap: splatData
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

        // Loop de animação interno
        const clock = new THREE.Clock();
        setInterval(() => {
            if (playerMixer) playerMixer.update(clock.getDelta());
        }, 1000 / 60);
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
        if (currentMode === 'paint') orbit.enabled = false;
    });

    window.addEventListener('resize', onWindowResize);
}

function paintAtMouse(event) {
    if (event.button !== 0 && !isPainting) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Checamos colisão exata APENAS com o chão de grama original para ler a UV Coordinates perfeitas
    const intersects = raycaster.intersectObject(floor);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const pt = intersect.point;

        if (brushTextureId === 'terra') {
            const uv = intersect.uv;
            const x = uv.x * splatCanvas.width;
            const y = (1 - uv.y) * splatCanvas.height;

            splatCtx.beginPath();
            const gradient = splatCtx.createRadialGradient(x, y, 0, x, y, brushSize);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

            splatCtx.fillStyle = gradient;
            splatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
            splatCtx.fill();

            splatTexture.needsUpdate = true;

        } else if (brushTextureId === 'grama' && editorGrassInstancedMeshes.length > 0) {
            // Se o limite de Instâncias no buffer não for atingido
            if (editorGrassInstancedMeshes[0].count < MAX_GRASS) {
                // Sorteia N graminhas (mais denso dependendo do brushSize)
                const grassQuantity = Math.floor(brushSize / 20) + 1;
                const radius = brushSize / 20; // 1 unidade mundial a cada 20 de brushSize

                let addedInThisTick = 0;
                const dummy = new THREE.Object3D();

                for (let i = 0; i < grassQuantity; i++) {
                    if (editorGrassInstancedMeshes[0].count >= MAX_GRASS) break;

                    const angle = Math.random() * Math.PI * 2;
                    const r = Math.random() * radius;
                    const dropX = pt.x + Math.cos(angle) * r;
                    const dropZ = pt.z + Math.sin(angle) * r;

                    const rotY = Math.random() * Math.PI * 2;
                    const sc = (0.8 + Math.random() * 0.5) * brushFoliageScale;

                    dummy.position.set(dropX, pt.y, dropZ);
                    dummy.rotation.set(0, rotY, 0);
                    dummy.scale.set(sc, sc, sc);
                    dummy.updateMatrixWorld(true);

                    editorGrassMatrices.push({
                        position: { x: dropX, y: pt.y, z: dropZ },
                        rotation: { x: 0, y: rotY, z: 0 },
                        scale: { x: sc, y: sc, z: sc }
                    });

                    editorGrassInstancedMeshes.forEach(iMesh => {
                        const finalMatrix = new THREE.Matrix4();
                        finalMatrix.multiplyMatrices(dummy.matrixWorld, iMesh.userData.localMatrix);
                        iMesh.setMatrixAt(iMesh.count, finalMatrix);
                        iMesh.count++;
                    });
                    addedInThisTick++;
                }

                if (addedInThisTick > 0) {
                    editorGrassInstancedMeshes.forEach(iMesh => iMesh.instanceMatrix.needsUpdate = true);
                    // Atualiza o contador de grama no último stroke lá na pilha de desfazer
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

    // Atualiza tempo do vento (convertendo performance.now para segundos)
    grassUniforms.uTime.value = performance.now() / 1000;

    orbit.update(); // Necessário para Damping
    renderer.render(scene, camera);
}
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.setSize(window.innerWidth, window.innerHeight);


function animate() {
    requestAnimationFrame(animate);

    // Atualiza tempo do vento (convertendo performance.now para segundos)
    grassUniforms.uTime.value = performance.now() / 1000;

    orbit.update(); // Necessário para Damping
    renderer.render(scene, camera);
}

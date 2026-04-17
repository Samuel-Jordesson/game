import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// --- CONFIGURAÇÕES ---
const MOVEMENT_SPEED = 2.0; // Velocidade de caminhada ajustada por você
const RUN_SPEED = 8.0;      // Velocidade de corrida
const ROTATION_SPEED = 10.0;

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, controls, sunLight, floor;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let shiftPressed = false;
let prevTime = performance.now();

// --- SISTEMA DE PULO ---
let isJumping = false;
let isJumpCharging = false;
let yVelocity = 0;
const GRAVITY = -25.0;
const JUMP_FORCE = 8.5;
const JUMP_DELAY_MS = 400;

// --- Efeito Cel Shading (Zelda Style) ---
const tones = new Uint8Array([80, 80, 80, 180, 180, 180, 255, 255, 255]);
const toonRamp = new THREE.DataTexture(tones, 3, 1, THREE.RedFormat);
toonRamp.minFilter = THREE.NearestFilter;
toonRamp.magFilter = THREE.NearestFilter;
toonRamp.generateMipmaps = false;
toonRamp.needsUpdate = true;

const grassUniforms = {
    uTime: { value: 0 }
};

// Third Person State 
let playerModel;
let playerMixer;
let idleAction, walkAction, runAction, jumpAction;
let activeAction = null;
let playerDirection = new THREE.Vector3();

const btnPlay = document.getElementById('btn-play');
const uiOverlay = document.getElementById('ui-overlay');
const mobileControls = document.getElementById('mobile-controls');
const btnShootMobile = document.getElementById('btn-shoot-mobile');

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let isMobilePlaying = false;
let joystickActive = false;
let joystickPos = new THREE.Vector2();
let lookSpeed = 0.005;

init();
animate();

function init() {
    // 1. Scene & Renderer (Upgraded Graphics)
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x888888, 0.005); // Fog mais realista que funde com o céu

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Sombra mais bonita por padrão

    // Tonemapping HDR para cores ultra-realistas (Faz a grama e céu saltarem aos olhos)
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    document.body.appendChild(renderer.domElement);

    // Pega o máximo de filtragem que a sua placa de vídeo suporta para não borrar o chão longe
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // Céu
    const skyLoader = new THREE.TextureLoader();
    const skyTexture = skyLoader.load('ceu/DaySkyHDRI027B_2K_TONEMAPPED.jpg', () => {
        skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture.colorSpace = THREE.SRGBColorSpace;
        scene.background = skyTexture;
        scene.environment = skyTexture;
    });

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Luzes
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Luz ambiente menor deixa a sombra mais escura
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffffff, 3.2); // Sol mais forte pra compensar a falta de luz ambiente
    sunLight.position.set(20, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;

    // Alta qualidade de sombras
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.bias = -0.0005; // Evita linhas pretas no chão
    sunLight.shadow.normalBias = 0.02; // Evita linhas pretas no corpo da raposa
    sunLight.shadow.radius = 1.5; // Bordas da sombra naturalmente suaves

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
            t.anisotropy = maxAnisotropy; // Deixa o chão incrivelmente nítido mesmo de lado
            t.colorSpace = THREE.SRGBColorSpace;
        }
    });

    const floorMaterial = new THREE.MeshStandardMaterial({
        map: groundBaseColor,
        normalMap: groundNormal,
        roughnessMap: groundRoughness,
        roughness: 1,
        metalness: 0
    });

    const floorGrid = 128; // Precisa ser igual ao editor
    const floorGeometry = new THREE.PlaneGeometry(1000, 1000, floorGrid, floorGrid);
    floorGeometry.attributes.position.usage = THREE.DynamicDrawUsage;

    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);


    // TERRA LAYER (Splatmap)
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

    const splatCanvas = document.createElement('canvas');
    splatCanvas.width = 1024;
    splatCanvas.height = 1024;
    const splatCtx = splatCanvas.getContext('2d');
    splatCtx.fillStyle = '#000000';
    splatCtx.fillRect(0, 0, 1024, 1024);

    const splatTexture = new THREE.CanvasTexture(splatCanvas);
    splatTexture.colorSpace = THREE.NoColorSpace;
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

    const dirtFloor = new THREE.Mesh(floorGeometry, dirtMaterial);
    dirtFloor.rotation.x = -Math.PI / 2;
    dirtFloor.position.y = 0.01;
    dirtFloor.receiveShadow = true;
    scene.add(dirtFloor);

    // ROCK LAYER (Relevo)
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

    const rockSplatCanvas = document.createElement('canvas');
    rockSplatCanvas.width = 1024;
    rockSplatCanvas.height = 1024;
    const rockSplatCtx = rockSplatCanvas.getContext('2d');
    const rockSplatTexture = new THREE.CanvasTexture(rockSplatCanvas);

    const rockMaterial = new THREE.MeshStandardMaterial({
        map: rockColor,
        normalMap: rockNormal,
        roughnessMap: rockRoughness,
        alphaMap: rockSplatTexture,
        transparent: true,
        alphaTest: 0.1
    });

    const rockFloor = new THREE.Mesh(floorGeometry, rockMaterial);
    rockFloor.rotation.x = -Math.PI / 2;
    rockFloor.position.y = 0.02;
    rockFloor.receiveShadow = true;
    scene.add(rockFloor);


    // Carregar Cenário do Editor com Otimização de Instancing!
    fetch('/cenario.json')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (!data) return;
            const fbxLoader = new FBXLoader();
            const gltfLoader = new GLTFLoader();

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
                if (data.rockSplatmap && rockSplatCtx) {
                    const img = new Image();
                    img.onload = () => {
                        rockSplatCtx.drawImage(img, 0, 0);
                        rockSplatTexture.needsUpdate = true;
                    };
                    img.src = data.rockSplatmap;
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

            // Agrupa modelos com o mesmo URL
            const modelGroups = {};
            mapObjects.forEach(item => {
                if (!modelGroups[item.url]) {
                    modelGroups[item.url] = { format: item.format, instances: [] };
                }
                modelGroups[item.url].instances.push(item);
            });

            for (const [url, group] of Object.entries(modelGroups)) {
                if (group.format === 'sprite' || url.includes('grama') || url === 'grama_sprite') {
                    // Grama otimizada procedural (Billboard Animado no futuro)
                    const plane1 = new THREE.PlaneGeometry(1, 1);
                    plane1.translate(0, 0.5, 0);
                    const plane2 = plane1.clone();
                    plane2.rotateY(Math.PI / 2);
                    const grassGeometry = BufferGeometryUtils.mergeGeometries([plane1, plane2]);

                    const grassTextureLoader = new THREE.TextureLoader();
                    grassTextureLoader.load('textura-terra/Group 166.png', (texture) => {
                        texture.colorSpace = THREE.SRGBColorSpace;
                        const grassMaterial = new THREE.MeshToonMaterial({
                            map: texture,
                            gradientMap: toonRamp,
                            transparent: true,
                            alphaTest: 0.5,
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

                        const currentQuality = document.getElementById('graphics-quality')?.value || 'medium';
                        const count = group.instances.length;
                        const iMesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, count);

                        // Sombras de grama apenas no máximo pra garantir FPS
                        iMesh.castShadow = (currentQuality === 'high');
                        iMesh.receiveShadow = (currentQuality === 'high');
                        iMesh.frustumCulled = false;
                        iMesh.userData.isGrass = true;

                        const dummy = new THREE.Object3D();
                        group.instances.forEach((item, index) => {
                            dummy.position.set(item.position.x, item.position.y, item.position.z);
                            dummy.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                            dummy.scale.set(item.scale.x, item.scale.y, item.scale.z);
                            dummy.updateMatrixWorld(true);
                            iMesh.setMatrixAt(index, dummy.matrixWorld);
                        });

                        iMesh.instanceMatrix.needsUpdate = true;
                        scene.add(iMesh);
                    });
                } else if (group.format === 'glb') {
                    // GLB recebe InstancedMesh para Alta Performance (Milhares de árvores)
                    gltfLoader.load(url, (gltf) => {
                        const defaultModel = gltf.scene;

                        // Reseta a base para zerar matrizes locais
                        defaultModel.position.set(0, 0, 0);
                        defaultModel.rotation.set(0, 0, 0);
                        defaultModel.scale.set(1, 1, 1);

                        // Passa 1: Material e escala local
                        defaultModel.traverse((child) => {
                            if (child.isMesh && child.material) {
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
                        });

                        // Atualiza a matriz AGORA que a folha já multiplicou 1.6
                        defaultModel.updateMatrixWorld(true);

                        const count = group.instances.length;
                        const dummy = new THREE.Object3D();

                        // Passa 2: Cria InstancedMesh
                        defaultModel.traverse((child) => {
                            if (child.isMesh) {
                                const iMesh = new THREE.InstancedMesh(child.geometry, child.material, count);

                                // Tag para a função applyGraphics encontrar essa árvore
                                iMesh.userData.isTree = true;

                                // Lê se a qualidade atual da tela é High para nascer com sombra
                                const currentQuality = document.getElementById('graphics-quality')?.value || 'medium';
                                iMesh.castShadow = (currentQuality === 'high');
                                iMesh.receiveShadow = true;

                                group.instances.forEach((item, index) => {
                                    dummy.position.set(item.position.x, item.position.y, item.position.z);
                                    dummy.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                                    dummy.scale.set(item.scale.x, item.scale.y, item.scale.z);
                                    dummy.updateMatrixWorld(true);

                                    const finalMatrix = new THREE.Matrix4();
                                    finalMatrix.multiplyMatrices(dummy.matrixWorld, child.matrixWorld);

                                    iMesh.setMatrixAt(index, finalMatrix);
                                });

                                iMesh.instanceMatrix.needsUpdate = true;
                                scene.add(iMesh);
                            }
                        });
                    });
                } else if (group.format === 'fbx') {
                    if (url.includes('Tree') || url.includes('arvore')) {
                        // Instanciamento de Árvores FBX para salvar FPS!
                        fbxLoader.load(url, (defaultModel) => {
                            // Reseta matriz base
                            defaultModel.position.set(0, 0, 0);
                            defaultModel.rotation.set(0, 0, 0);
                            defaultModel.scale.set(0.01, 0.01, 0.01); // FBX usa 0.01 normalmente

                            // Passa 1: Material e escala de folhas
                            defaultModel.traverse((child) => {
                                if (child.isMesh && child.material) {
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
                            });

                            // Atualiza Matrix Mundo
                            defaultModel.updateMatrixWorld(true);

                            const count = group.instances.length;
                            const dummy = new THREE.Object3D();

                            // Passa 2: Construir Mesh
                            defaultModel.traverse((child) => {
                                if (child.isMesh) {
                                    const iMesh = new THREE.InstancedMesh(child.geometry, child.material, count);

                                    iMesh.userData.isTree = true;
                                    const currentQuality = document.getElementById('graphics-quality')?.value || 'medium';
                                    iMesh.castShadow = (currentQuality === 'high');
                                    iMesh.receiveShadow = true;

                                    group.instances.forEach((item, index) => {
                                        dummy.position.set(item.position.x, item.position.y, item.position.z);
                                        dummy.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                                        dummy.scale.set(item.scale.x, item.scale.y, item.scale.z);
                                        dummy.updateMatrixWorld(true);

                                        const finalMatrix = new THREE.Matrix4();
                                        finalMatrix.multiplyMatrices(dummy.matrixWorld, child.matrixWorld);

                                        iMesh.setMatrixAt(index, finalMatrix);
                                    });

                                    iMesh.instanceMatrix.needsUpdate = true;
                                    scene.add(iMesh);
                                }
                            });
                        });
                    } else {
                        // FBX normal (Captain Croaker) continua instanciado um a um
                        group.instances.forEach(item => {
                            fbxLoader.load(item.url, (model) => {
                                model.traverse((child) => {
                                    if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
                                });
                                model.scale.set(0.01, 0.01, 0.01);

                                const spawnGroup = new THREE.Group();
                                spawnGroup.position.set(item.position.x, item.position.y, item.position.z);
                                spawnGroup.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                                spawnGroup.scale.set(item.scale.x, item.scale.y, item.scale.z);
                                spawnGroup.add(model);

                                scene.add(spawnGroup);
                            });
                        });
                    }
                }
            }
        }).catch(err => console.log("Nenhum cenário anterior encontrado."));

    // Jogador: Pivot central
    playerModel = new THREE.Group();
    playerModel.position.set(0, 0, 0);
    playerModel.rotation.y = Math.PI;
    scene.add(playerModel);

    // Carregar Raposa
    const gltfLoader = new GLTFLoader();

    gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Idle_5_withSkin.glb', (gltf) => {
        const model = gltf.scene;

        const outlines = [];
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Toon Material for Cel Shading
                if (child.material) {
                    const oldMat = child.material;
                    const newMat = new THREE.MeshToonMaterial({
                        map: oldMat.map,
                        gradientMap: toonRamp,
                        color: oldMat.color,
                        transparent: oldMat.transparent,
                        alphaTest: oldMat.alphaTest,
                        side: oldMat.side
                    });
                    child.material = newMat;

                    const outlineMesh = child.clone();
                    outlineMesh.material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
                    outlineMesh.scale.multiplyScalar(1.02);
                    if (child.isSkinnedMesh) {
                        outlineMesh.bind(child.skeleton, child.bindMatrix);
                    }
                    outlines.push({ parent: child.parent, mesh: outlineMesh });
                }
            }
        });
        outlines.forEach(item => item.parent.add(item.mesh));

        playerModel.add(model);
        playerMixer = new THREE.AnimationMixer(model);

        if (gltf.animations && gltf.animations.length > 0) {
            idleAction = playerMixer.clipAction(gltf.animations[0]);
            idleAction.play();
            activeAction = idleAction;
        }

        gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Walking_withSkin.glb', (walkGltf) => {
            if (walkGltf.animations && walkGltf.animations.length > 0) {
                walkAction = playerMixer.clipAction(walkGltf.animations[0]);
                walkAction.play();
                walkAction.weight = 0;
            }
        });

        gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Running_withSkin.glb', (runGltf) => {
            if (runGltf.animations && runGltf.animations.length > 0) {
                runAction = playerMixer.clipAction(runGltf.animations[0]);
                runAction.play();
                runAction.weight = 0;
            }
        });

        gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Regular_Jump_withSkin.glb', (jumpGltf) => {
            if (jumpGltf.animations && jumpGltf.animations.length > 0) {
                jumpAction = playerMixer.clipAction(jumpGltf.animations[0]);
                jumpAction.setLoop(THREE.LoopOnce); // Pula apenas 1x
                jumpAction.clampWhenFinished = true; // Congela na pose final de queda até bater no chão
                jumpAction.play();
                jumpAction.weight = 0;
            }
        });
    });

    // Controles PointerLock para a MIRA
    controls = new PointerLockControls(camera, document.body);

    const handlePlay = () => {
        if (isMobile) {
            isMobilePlaying = true;
            uiOverlay.style.opacity = '0';
            setTimeout(() => { uiOverlay.style.display = 'none'; }, 500);
        } else {
            controls.lock();
        }
    };

    btnPlay.addEventListener('click', handlePlay);
    btnPlay.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handlePlay();
    });

    controls.addEventListener('lock', () => {
        uiOverlay.style.opacity = '0';
        setTimeout(() => { uiOverlay.style.display = 'none'; }, 500);
    });

    controls.addEventListener('unlock', () => {
        uiOverlay.style.display = 'flex';
        setTimeout(() => { uiOverlay.style.opacity = '1'; }, 10);
    });

    // Lógica do Menu de Configurações Dinâmicas de Gráfico
    const btnSettings = document.getElementById('btn-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const buttonList = document.getElementById('button-list');
    const btnBack = document.getElementById('btn-back');
    const graphicsQuality = document.getElementById('graphics-quality');
    const shadowSoftness = document.getElementById('shadow-softness');
    const shadowValue = document.getElementById('shadow-value');

    if (btnSettings && settingsPanel && buttonList && btnBack) {
        btnSettings.addEventListener('click', () => {
            buttonList.style.display = 'none';
            settingsPanel.style.display = 'flex';
        });

        btnBack.addEventListener('click', () => {
            settingsPanel.style.display = 'none';
            buttonList.style.display = 'block';
        });

        graphicsQuality.addEventListener('change', (e) => {
            applyGraphics(e.target.value);
        });

        if (shadowSoftness && shadowValue) {
            shadowSoftness.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                shadowValue.innerText = val.toFixed(1);
                if (sunLight) {
                    sunLight.shadow.radius = val;
                }
            });
        }
    }

    function applyGraphics(quality) {
        if (!renderer || !sunLight) return;

        // Limpa o mapa de sombra para forçar redraw do novo tamanho
        if (sunLight.shadow.map) {
            sunLight.shadow.map.dispose();
            sunLight.shadow.map = null;
        }

        if (quality === 'low') {
            renderer.setPixelRatio(1);
            renderer.shadowMap.enabled = false;
        } else if (quality === 'medium') {
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2) || 1);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;
            sunLight.shadow.mapSize.set(1024, 1024);
        } else if (quality === 'high') {
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) || 2);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Ultra sombras
            sunLight.shadow.mapSize.set(2048, 2048); // Alta Resolução
        }

        scene.traverse((child) => {
            // Togle sombras das instâncias
            if (child.isInstancedMesh && child.userData) {
                if (child.userData.isTree) {
                    child.castShadow = (quality === 'high');
                }
                if (child.userData.isGrass) {
                    child.castShadow = (quality === 'high');
                    child.receiveShadow = (quality === 'high');
                }
            }

            if (child.isMesh && child.material) {
                child.material.needsUpdate = true;
            }
        });
    }

    // Eventos Teclado
    const onKeyDown = (e) => {
        if (e.code === 'KeyW') moveForward = true;
        if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true;
        if (e.code === 'KeyD') moveRight = true;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftPressed = true;
        if (e.code === 'Space' && !isJumping && !isJumpCharging) {
            isJumping = true; // Inicia a animação instantaneamente
            isJumpCharging = true;

            // Espera o delay antes de aplicar a física de subida
            setTimeout(() => {
                isJumpCharging = false;
                yVelocity = JUMP_FORCE;
            }, JUMP_DELAY_MS);
        }
    };
    const onKeyUp = (e) => {
        if (e.code === 'KeyW') moveForward = false;
        if (e.code === 'KeyA') moveLeft = false;
        if (e.code === 'KeyS') moveBackward = false;
        if (e.code === 'KeyD') moveRight = false;
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftPressed = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    if (btnShootMobile) btnShootMobile.style.display = 'none';

    if (isMobile) {
        mobileControls.style.display = 'flex';

        const joystickBase = document.getElementById('joystick-base');
        const joystickHandle = document.getElementById('joystick-handle');
        const baseRect = joystickBase.getBoundingClientRect();
        const centerX = baseRect.left + baseRect.width / 2;
        const centerY = baseRect.top + baseRect.height / 2;
        const maxRadius = baseRect.width / 2;

        const handleMove = (x, y) => {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.min(Math.sqrt(dx * dx + dy * dy), maxRadius);
            const angle = Math.atan2(dy, dx);
            const handleX = Math.cos(angle) * distance;
            const handleY = Math.sin(angle) * distance;

            joystickHandle.style.transform = `translate(${handleX}px, ${handleY}px)`;
            joystickPos.set(handleX / maxRadius, -handleY / maxRadius);
            joystickActive = true;
        };

        joystickBase.addEventListener('touchstart', (e) => handleMove(e.touches[0].clientX, e.touches[0].clientY));
        joystickBase.addEventListener('touchmove', (e) => { e.preventDefault(); handleMove(e.touches[0].clientX, e.touches[0].clientY); });
        joystickBase.addEventListener('touchend', () => {
            joystickHandle.style.transform = `translate(0px, 0px)`;
            joystickPos.set(0, 0);
            joystickActive = false;
        });

        let lastTouchX = 0;
        let lastTouchY = 0;

        document.addEventListener('touchstart', (e) => {
            if (e.target.closest('#mobile-controls')) return;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        });

        document.addEventListener('touchmove', (e) => {
            if (e.target.closest('#mobile-controls')) return;
            if (!isMobilePlaying) return;

            const dx = e.touches[0].clientX - lastTouchX;
            const dy = e.touches[0].clientY - lastTouchY;

            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.setFromQuaternion(camera.quaternion);
            euler.y -= dx * lookSpeed * 2.0;
            euler.x -= dy * lookSpeed * 2.0;
            euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
            camera.quaternion.setFromEuler(euler);

            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        });
    }

    window.addEventListener('resize', onWindowResize);
}

const groundRaycaster = new THREE.Raycaster();
const downVec = new THREE.Vector3(0, -1, 0);

function getTerrainHeight(x, z) {
    if (!floor) return 0;
    // Raycast do céu para baixo para achar a altura do relevo
    groundRaycaster.set(new THREE.Vector3(x, 100, z), downVec);
    const intersects = groundRaycaster.intersectObject(floor);
    if (intersects.length > 0) {
        return intersects[0].point.y;
    }
    return 0;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Atualiza tempo do vento (segundos)
    grassUniforms.uTime.value = time / 1000;

    const fps = Math.round(1 / delta);
    if (time % 10 < 1) {
        document.getElementById('fps-counter').innerText = `FPS: ${fps}`;
    }

    if (controls.isLocked || isMobilePlaying) {

        // --- GRAVIDADE E PULO ---
        if (isJumping) {
            // Só aplica gravidade se já terminou a pose de "preparar pulo"
            if (!isJumpCharging) {
                yVelocity += GRAVITY * delta;
                playerModel.position.y += yVelocity * delta;
            }

            // Se encostar no chão de novo e estiver CAINDO
            const terrainHeight = getTerrainHeight(playerModel.position.x, playerModel.position.z);
            if (!isJumpCharging && playerModel.position.y <= terrainHeight && yVelocity <= 0) {
                playerModel.position.y = terrainHeight;
                isJumping = false;
                yVelocity = 0;
            }
        } else {
            // Se não estiver pulando, mantém colado no chão (seguindo o relevo)
            const terrainHeight = getTerrainHeight(playerModel.position.x, playerModel.position.z);
            playerModel.position.y = terrainHeight;
        }

        playerDirection.z = Number(moveBackward) - Number(moveForward);
        playerDirection.x = Number(moveRight) - Number(moveLeft);

        if (isMobile && joystickActive) {
            playerDirection.z = -joystickPos.y;
            playerDirection.x = joystickPos.x;
        }

        playerDirection.normalize();

        const moving = playerDirection.length() > 0.1;
        let targetAction = idleAction;
        let currentSpeed = 0;

        if (moving) {
            if (shiftPressed) {
                targetAction = runAction;
                currentSpeed = RUN_SPEED;
            } else {
                targetAction = walkAction;
                currentSpeed = MOVEMENT_SPEED;
            }
        }

        // Action Override se estiver no ar (Pulo domina a máquina de estado)
        if (isJumping && jumpAction) {
            targetAction = jumpAction;
        }

        // Transição suave entre Animações
        if (targetAction && activeAction !== targetAction) {
            if (targetAction === jumpAction) {
                targetAction.reset(); // Força a animação de pulo começar do Zero toda vez que sai do chão
            }

            targetAction.reset().fadeIn(0.2).play();
            targetAction.weight = 1;

            if (activeAction) {
                activeAction.fadeOut(0.2);
            }
            activeAction = targetAction;
        }

        if (moving) {
            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.setFromQuaternion(camera.quaternion);
            const yaw = euler.y;

            const moveX = playerDirection.x * Math.cos(yaw) + playerDirection.z * Math.sin(yaw);
            const moveZ = -playerDirection.x * Math.sin(yaw) + playerDirection.z * Math.cos(yaw);

            playerModel.position.x += moveX * currentSpeed * delta;
            playerModel.position.z += moveZ * currentSpeed * delta;

            const targetRotation = Math.atan2(moveX, moveZ);
            let diff = targetRotation - playerModel.rotation.y;

            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            playerModel.rotation.y += diff * ROTATION_SPEED * delta;
        }

        const targetPoint = playerModel.position.clone();
        targetPoint.y += 1.5;

        const offset = new THREE.Vector3(0, 0, 5);
        offset.applyQuaternion(camera.quaternion);

        camera.position.copy(targetPoint).add(offset);
    }

    if (playerMixer) {
        playerMixer.update(delta);
    }

    prevTime = time;
    renderer.render(scene, camera);
}

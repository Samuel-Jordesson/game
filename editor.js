import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

let scene, camera, renderer, orbit, transformControl;
let raycaster, mouse;
const objectsToIntersect = [];
let isTransforming = false;

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
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
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
        if(t) {
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
        if(t) {
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
            selectedNameSpan.innerText = 'Modo Pintura';
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
                    transformControl.detach();
                    scene.remove(obj);
                    const index = objectsToIntersect.indexOf(obj);
                    if (index > -1) objectsToIntersect.splice(index, 1);
                    selectedNameSpan.innerText = 'Nenhum';
                }
                break;
        }
    });

    // Lógica da Livraria de Modelos (Spawn)
    const btnSpawnCroaker = document.getElementById('btn-spawn-croaker');
    const btnSpawnTree1 = document.getElementById('btn-spawn-tree1');
    let astCount = 0;

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
                if(res.ok) {
                    btnSaveMap.innerText = '✅ Salvo!';
                } else {
                    btnSaveMap.innerText = '❌ Erro ao salvar';
                }
            } catch(e) {
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
                if (item.format === 'fbx') {
                    fbxLoader.load(item.url, (model) => {
                        astCount++;
                        model.traverse((child) => {
                            if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
                        });
                        model.scale.set(0.01, 0.01, 0.01);
                        
                        const spawnGroup = new THREE.Group();
                        spawnGroup.userData = { isMapEditorObject: true, url: item.url, format: item.format };
                        spawnGroup.position.set(item.position.x, item.position.y, item.position.z);
                        spawnGroup.rotation.set(item.rotation.x, item.rotation.y, item.rotation.z);
                        spawnGroup.scale.set(item.scale.x, item.scale.y, item.scale.z);
                        spawnGroup.name = `Sapo (${astCount})`;
                        spawnGroup.add(model);
                        
                        scene.add(spawnGroup);
                        objectsToIntersect.push(spawnGroup);
                    });
                } else if (item.format === 'glb') {
                    localGltfLoader.load(item.url, (gltf) => {
                        astCount++;
                        const model = gltf.scene;
                        model.traverse((child) => {
                            if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
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
        }).catch(err => console.log("Sem cenario anterior", err));

    // Load Fox
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('raposa/Meshy_AI_Captain_Fox_biped_Animation_Idle_5_withSkin.glb', (gltf) => {
        const model = gltf.scene;
        model.name = "Raposa (Modelo Fisico)";
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
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
        const uv = intersect.uv;

        // O Canvas é 1024x1024
        const x = uv.x * splatCanvas.width;
        // O UV.y do ThreeJS é invertido do Y do HTML Canvas
        const y = (1 - uv.y) * splatCanvas.height;

        splatCtx.beginPath();
        // Um brush size de 50 é relativo ao Canvas de 1024, criando trilhas ótimas
        // Mas podemos criar gradiente (blur) pro pincel!
        const gradient = splatCtx.createRadialGradient(x, y, 0, x, y, brushSize);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        splatCtx.fillStyle = gradient;
        splatCtx.arc(x, y, brushSize, 0, Math.PI * 2);
        splatCtx.fill();

        splatTexture.needsUpdate = true; // Avisa o renderizador p/ atualizar o Material de Terra
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
    orbit.update(); // Necessário para Damping
    renderer.render(scene, camera);
}

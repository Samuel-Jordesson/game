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

try {
    init();
    animate();
} catch (error) {
    alert("ERRO FATAL NO EDITOR: " + error.message + "\n" + error.stack);
}

function updateButtonStyles(mode) {
    btnTranslate.classList.remove('active-btn');
    btnRotate.classList.remove('active-btn');
    btnScale.classList.remove('active-btn');
    
    if (mode === 'translate') btnTranslate.classList.add('active-btn');
    if (mode === 'rotate') btnRotate.classList.add('active-btn');
    if (mode === 'scale') btnScale.classList.add('active-btn');
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
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

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

    // Botões da Tela (Modo da Seta)
    btnTranslate.addEventListener('click', () => { transformControl.setMode('translate'); updateButtonStyles('translate'); });
    btnRotate.addEventListener('click', () => { transformControl.setMode('rotate'); updateButtonStyles('rotate'); });
    btnScale.addEventListener('click', () => { transformControl.setMode('scale'); updateButtonStyles('scale'); });

    window.addEventListener('keydown', function (event) {
        switch (event.key.toLowerCase()) {
            case 'w': transformControl.setMode('translate'); updateButtonStyles('translate'); break;
            case 'e': transformControl.setMode('rotate'); updateButtonStyles('rotate'); break;
            case 'r': transformControl.setMode('scale'); updateButtonStyles('scale'); break;
        }
    });

    // Lógica da Livraria de Modelos (Spawn)
    const btnSpawnCroaker = document.getElementById('btn-spawn-croaker');
    let sapoCount = 0;

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

    // Raycaster (Para poder dar clique nos objetos)
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onWindowResize);
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

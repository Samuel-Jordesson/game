import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- CONFIGURAÇÕES ---
const MOVEMENT_SPEED = 12.0;
const FRICTION = 10.0;
const GUN_BOB_SPEED = 10.0;
const GUN_BOB_AMOUNT = 0.05;

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, controls, weapon;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
const mixers = []; // Para lidar com animações
const bullets = []; // Para rastrear tiros
const BULLET_SPEED = 100.0;
const BULLET_LIFE = 2.0; // Segundos antes do tiro sumir

const btnPlay = document.getElementById('btn-play');
const uiOverlay = document.getElementById('ui-overlay');
const mobileControls = document.getElementById('mobile-controls');
const btnShootMobile = document.getElementById('btn-shoot-mobile');

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let isMobilePlaying = false; // Flag manual para mobile
let joystickActive = false;
let joystickPos = new THREE.Vector2();
let touchRotation = { lat: 0, lon: 0 };
let lookSpeed = 0.002;

console.log("Iniciando motor do jogo...");

init();
animate();

function init() {
    // 1. Cena e Câmera
    scene = new THREE.Scene();

    // Configuração de Céu (HDRI Panorama)
    const skyLoader = new THREE.TextureLoader();
    const skyTexture = skyLoader.load('ceu/DaySkyHDRI027B_2K_TONEMAPPED.jpg', () => {
        skyTexture.mapping = THREE.EquirectangularReflectionMapping;
        skyTexture.colorSpace = THREE.SRGBColorSpace;
        scene.background = skyTexture;
        scene.environment = skyTexture; // Isso faz os modelos refletirem o céu
    });

    scene.fog = new THREE.Fog(0x888888, 0, 200);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.7, 5); // Começa um pouco atrás para ver o chão

    // 2. Luzes (Potentes para garantir visibilidade)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    sunLight.position.set(20, 40, 20);
    sunLight.castShadow = true;

    // Configurações de sombra otimizadas para performance
    sunLight.shadow.camera.left = -50;
    sunLight.shadow.camera.right = 50;
    sunLight.shadow.camera.top = 50;
    sunLight.shadow.camera.bottom = -50;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;
    sunLight.shadow.mapSize.width = 1024; // Reduzido de 2048 para 1024
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.bias = -0.001;

    scene.add(sunLight);

    const pointLight = new THREE.PointLight(0xffffff, 2.0);
    pointLight.position.set(0, 5, 0);
    scene.add(pointLight);

    // 3. Chão com Textura Realista PBR
    const groundLoader = new THREE.TextureLoader();
    const groundBaseColor = groundLoader.load('textura-terra/Ground037_2K-PNG_Color.png');
    const groundNormal = groundLoader.load('textura-terra/Ground037_2K-PNG_NormalGL.png');
    const groundRoughness = groundLoader.load('textura-terra/Ground037_2K-PNG_Roughness.png');
    const groundAmbientOcclusion = groundLoader.load('textura-terra/Ground037_2K-PNG_AmbientOcclusion.png');

    // Configura Repetição (Tiling) para o chão não ficar esticado
    const repeatX = 100;
    const repeatY = 100;
    [groundBaseColor, groundNormal, groundRoughness, groundAmbientOcclusion].forEach(t => {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeatX, repeatY);
    });

    const floorGeometry = new THREE.PlaneGeometry(1000, 1000);
    const floorMaterial = new THREE.MeshStandardMaterial({
        map: groundBaseColor,
        normalMap: groundNormal,
        roughnessMap: groundRoughness,
        // aoMap removido para performance
        roughness: 1,
        metalness: 0
    });

    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(1000, 100, 0x555555, 0x333333);
    scene.add(grid);

    // 5. Carregar Arma (arma.fbx)
    console.log("Tentando carregar arma.fbx...");
    const loader = new FBXLoader();
    loader.load('arma.fbx', (fbx) => {
        console.log('Arma FBX carregada!', fbx);
        weapon = fbx;

        // CORREÇÃO DE MATERIAL: Garante que a arma seja visível mesmo sem texturas
        weapon.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.color.set(0x888888); // Cinza base
                    if (child.material.type === 'MeshPhongMaterial' || child.material.type === 'MeshStandardMaterial') {
                        child.material.emissive.set(0x111111);
                    }
                }
            }
        });

        // Ajuste de escala
        weapon.scale.set(0.008, 0.008, 0.008);

        // Posicionamento na visão do personagem
        camera.add(weapon);
        scene.add(camera);

        // Ajuste fino da posição e ROTAÇÃO (90 graus adicionais)
        weapon.position.set(0.4, -0.4, -0.8);
        weapon.rotation.set(0, Math.PI * 1.5, 0); // Rotacionado 90 graus em relação ao anterior (era Math.PI)

    }, (xhr) => {
        console.log((xhr.loaded / xhr.total * 100) + '% carregado');
    }, (error) => {
        console.error('Erro ao carregar FBX:', error);

        // Fallback: Bloco retangular se o arquivo falhar
        const geo = new THREE.BoxGeometry(0.15, 0.15, 0.7);
        const mat = new THREE.MeshStandardMaterial({ color: 0x555555 });
        weapon = new THREE.Mesh(geo, mat);
        camera.add(weapon);
        scene.add(camera);
        weapon.position.set(0.4, -0.4, -0.8);
    });

    // 6. Carregar Personagem (GLB Otimizado)
    console.log("Carregando novo personagem GLB...");
    const gltfLoader = new GLTFLoader();

    gltfLoader.load('teste/teste.glb', (gltf) => {
        console.log('Personagem GLB carregado!');
        const model = gltf.scene;

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Posicionamento no centro
        model.position.set(0, 0, -8);
        model.scale.set(1.5, 1.5, 1.5); // Ajuste de escala para GLB
        scene.add(model);

        // Se tiver animação no GLB, toca a primeira
        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
            mixers.push(mixer);
        }

    }, undefined, (error) => {
        console.error('Erro ao carregar GLB:', error);
    });

    // 6. Carregar Personagem Animado (Dançarino de Hip Hop GLB)
    console.log("Carregando dançarino GLB...");
    gltfLoader.load('hiphop/danci.glb', (gltf) => {
        console.log('Dançarino GLB carregado!');
        const model = gltf.scene;

        // Ajuste de escala e posição
        model.scale.set(1.5, 1.5, 1.5);
        model.position.set(3, 0, -5);
        model.rotation.y = -0.5;

        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        // Configurar Mixagem de Animação
        const mixer = new THREE.AnimationMixer(model);
        if (gltf.animations && gltf.animations.length > 0) {
            const action = mixer.clipAction(gltf.animations[0]);
            action.play();
        }
        mixers.push(mixer);

        scene.add(model);
    }, undefined, (err) => {
        console.error("Erro ao carregar dançarino GLB:", err);
    });
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

    // Eventos de Teclado
    const onKeyDown = (e) => {
        if (e.code === 'KeyW') moveForward = true;
        if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true;
        if (e.code === 'KeyD') moveRight = true;
    };
    const onKeyUp = (e) => {
        if (e.code === 'KeyW') moveForward = false;
        if (e.code === 'KeyA') moveLeft = false;
        if (e.code === 'KeyS') moveBackward = false;
        if (e.code === 'KeyD') moveRight = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Sistema de Tiro
    const onMouseDown = (event) => {
        if (controls.isLocked && event.button === 0) {
            shoot();
        }
    };
    document.addEventListener('mousedown', onMouseDown);

    // --- CONTROLES MOBILE ---
    if (isMobile) {
        mobileControls.style.display = 'flex';

        // Tiro mobile
        btnShootMobile.addEventListener('touchstart', (e) => {
            e.preventDefault();
            shoot();
        });

        // Joystick
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

            // Define direção do movimento
            joystickPos.set(handleX / maxRadius, -handleY / maxRadius);
            joystickActive = true;
        };

        joystickBase.addEventListener('touchstart', (e) => {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        });

        joystickBase.addEventListener('touchmove', (e) => {
            e.preventDefault();
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
        });

        joystickBase.addEventListener('touchend', () => {
            joystickHandle.style.transform = `translate(0px, 0px)`;
            joystickPos.set(0, 0);
            joystickActive = false;
        });

        // Rotação da Câmera por Toque (arrastar no resto da tela)
        let lastTouchX = 0;
        let lastTouchY = 0;

        document.addEventListener('touchstart', (e) => {
            if (e.target.closest('#mobile-controls')) return;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        });

        document.addEventListener('touchmove', (e) => {
            if (e.target.closest('#mobile-controls')) return;
            if (!controls.isLocked) return;

            const dx = e.touches[0].clientX - lastTouchX;
            const dy = e.touches[0].clientY - lastTouchY;

            // Aplica rotação simulando o mouse
            const movementX = dx * 2.0;
            const movementY = dy * 2.0;

            // Simula o PointerLockControls movendo a câmera diretamente
            const euler = new THREE.Euler(0, 0, 0, 'YXZ');
            euler.setFromQuaternion(camera.quaternion);
            euler.y -= movementX * lookSpeed;
            euler.x -= movementY * lookSpeed;
            euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
            camera.quaternion.setFromEuler(euler);

            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
        });
    }

    // 7. Renderer Otimizado
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limita em 2x (4K nativo é pesado demais)
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // De PCFSoft (pesado) para PCF (leve)
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function shoot() {
    if (!weapon) return;

    // 1. Efeito de Recoio (retrocesso da arma)
    weapon.position.z += 0.1;

    // 2. Criar o "Laser"
    // Pegamos a posição e direção da câmera
    const bulletGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8);
    const bulletMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 0.8
    });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);

    // Posiciona o tiro na ponta da arma
    // Como a arma é filha da câmera, pegamos a posição do mundo da câmera
    const gunPointer = new THREE.Vector3();
    camera.getWorldPosition(gunPointer);

    const gunDirection = new THREE.Vector3();
    camera.getWorldDirection(gunDirection);

    bullet.position.copy(gunPointer);
    bullet.position.addScaledVector(gunDirection, 0.5); // Um pouco à frente da câmera

    // Alinha o cilindro com a direção do tiro
    bullet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gunDirection);

    // Luz brilhante para o tiro (REMOVIDO para performance, usando apenas emissivo)
    // const bulletLight = new THREE.PointLight(0x00ff00, 1, 2);
    // bullet.add(bulletLight);

    bullet.userData = {
        velocity: gunDirection.clone().multiplyScalar(BULLET_SPEED),
        life: BULLET_LIFE
    };

    scene.add(bullet);
    bullets.push(bullet);
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Calcular e exibir FPS
    const fps = Math.round(1 / delta);
    if (time % 10 < 1) { // Atualiza o texto apenas em intervalos curtos para não pesar
        document.getElementById('fps-counter').innerText = `FPS: ${fps}`;
    }

    if (controls.isLocked || isMobilePlaying) {
        velocity.x -= velocity.x * FRICTION * delta;
        velocity.z -= velocity.z * FRICTION * delta;

        if (isMobile && joystickActive) {
            // Movimento via Joystick
            velocity.z -= joystickPos.y * MOVEMENT_SPEED * delta;
            velocity.x -= joystickPos.x * MOVEMENT_SPEED * delta;
        } else {
            // Movimento via Teclado
            direction.z = Number(moveForward) - Number(moveBackward);
            direction.x = Number(moveRight) - Number(moveLeft);
            direction.normalize();

            if (moveForward || moveBackward) velocity.z -= direction.z * MOVEMENT_SPEED * delta;
            if (moveLeft || moveRight) velocity.x -= direction.x * MOVEMENT_SPEED * delta;
        }

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Bobbing e Recoio da arma
        if (weapon) {
            const isMoving = (moveForward || moveBackward || moveLeft || moveRight) || (isMobile && joystickActive);

            // Retorno suave do recoio (volta para a posição original -0.8)
            const targetZ = -0.8;
            weapon.position.z += (targetZ - weapon.position.z) * 0.1;

            if (isMoving) {
                const bob = Math.sin(time / 1000 * GUN_BOB_SPEED);
                weapon.position.y = -0.4 + bob * GUN_BOB_AMOUNT;
                weapon.position.x = 0.4 + Math.cos(time / 1000 * 5) * 0.02;
            } else {
                weapon.position.y += (-0.4 - weapon.position.y) * 0.1;
                weapon.position.x += (0.4 - weapon.position.x) * 0.1;
            }
        }
    }

    // Atualizar Projéteis
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.position.addScaledVector(b.userData.velocity, delta);
        b.userData.life -= delta;

        if (b.userData.life <= 0) {
            scene.remove(b);
            bullets.splice(i, 1);
        }
    }

    // Atualizar todas as animações
    for (const mixer of mixers) {
        mixer.update(delta);
    }

    prevTime = time;
    renderer.render(scene, camera);
}

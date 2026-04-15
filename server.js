const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Servindo arquivos estáticos da pasta atual
app.use(express.static(__dirname));

// Rota principal para o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const os = require('os');

// Função para buscar o IP da rede local
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIp = getLocalIp();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor do Jogo iniciado!`);
    console.log(`-----------------------------------------`);
    console.log(`Acesso Local:    http://localhost:${PORT}`);
    console.log(`Acesso na Rede:  http://${localIp}:${PORT}`);
    console.log(`-----------------------------------------`);
    console.log(`Pressione CTRL+C para parar o servidor.\n`);
});

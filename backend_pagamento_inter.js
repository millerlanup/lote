const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const cert = fs.readFileSync('./Inter API_Certificado.crt');
const key = fs.readFileSync('./Inter API_Chave.key');

const agent = new https.Agent({
  cert,
  key,
  rejectUnauthorized: false
});

app.post('/pagar', async (req, res) => {
  try {
    // 1. Gerar token
    const tokenResp = await axios.post(
      'https://cdpj.partners.bancointer.com.br/oauth/v2/token',
      `grant_type=client_credentials&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: agent
      }
    );

    const accessToken = tokenResp.data.access_token;

    // 2. Fazer pagamento
    const results = [];
    for (const item of req.body.pagamentos) {
      const pagamento = await axios.post(
        'https://cdpj.partners.bancointer.com.br/pix/payments',
        {
          valor: item.valor,
          chave: item.chave,
          descricao: item.descricao,
          tipoChave: item.tipoChave
        },
        {
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
          },
          httpsAgent: agent
        }
      );
      results.push({ chave: item.chave, status: 'ok', response: pagamento.data });
    }

    res.json({ status: 'success', results });

  } catch (error) {
    console.error("Erro completo:", error.toJSON ? error.toJSON() : error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      details: error.response ? error.response.data : 'sem detalhes'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

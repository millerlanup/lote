const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid'); // Para gerar x-id-idempotente

require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Certificados (coloque os arquivos no mesmo diretório)
const cert = fs.readFileSync('./Inter API_Certificado.crt');
const key = fs.readFileSync('./Inter API_Chave.key');

const httpsAgent = new https.Agent({
  cert,
  key,
  rejectUnauthorized: false
});

app.post('/pagar', async (req, res) => {
  try {
    // 1. Obter token OAuth2
    const tokenResponse = await axios.post(
      'https://cdpj.partners.bancointer.com.br/oauth/v2/token',
      `client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&scope=pagamento-pix.write&grant_type=client_credentials`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent
      }
    );

    const accessToken = tokenResponse.data.access_token;

    const results = [];

    // 2. Para cada pagamento no corpo da requisição
    for (const item of req.body.pagamentos) {
      const corpoPix = {
        valor: item.valor.toFixed(2),
        descricao: item.descricao || 'Pagamento via API Inter',
        destinatario: {
          tipo: 'CHAVE',
          chave: item.chave
        }
      };

      if (item.dataPagamento) {
        corpoPix.dataPagamento = item.dataPagamento;
      }

      const pagamentoPix = await axios.post(
        'https://cdpj.partners.bancointer.com.br/banking/v2/pix',
        corpoPix,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-conta-corrente': process.env.CONTA_CORRENTE,
            'x-id-idempotente': uuidv4()
          },
          httpsAgent
        }
      );

      results.push({
        chave: item.chave,
        status: 'ok',
        response: pagamentoPix.data
      });
    }

    res.json({ status: 'success', results });

  } catch (error) {
    console.error("Erro completo:", error?.response?.data || error);
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

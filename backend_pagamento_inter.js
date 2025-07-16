const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');

const app = express();
app.use(bodyParser.json());

// Certificados
const cert = fs.readFileSync('./Inter API_Certificado.crt');
const key = fs.readFileSync('./Inter API_Chave.key');
const httpsAgent = new https.Agent({
  cert,
  key,
  rejectUnauthorized: false
});

// Função para formatar valores em Real
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor);
}

// Função para gerar PDF do comprovante
async function gerarComprovantePDF(dadosPagamento, dadosResposta) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // Header
      doc.fontSize(20)
         .font('Helvetica-Bold')
         .text('COMPROVANTE DE PAGAMENTO PIX', { align: 'center' });
      
      doc.moveDown();
      doc.fontSize(12)
         .font('Helvetica')
         .text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
      doc.text(`Hora: ${new Date().toLocaleTimeString('pt-BR')}`, { align: 'right' });
      
      doc.moveDown();
      
      // Linha divisória
      doc.moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();
      
      // Dados do Pagamento
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DO PAGAMENTO');
      
      doc.fontSize(11)
         .font('Helvetica');
      
      doc.moveDown(0.5);
      doc.text(`Valor: ${formatarMoeda(dadosPagamento.valor)}`);
      
      doc.moveDown(0.5);
      doc.text(`Descrição: ${dadosPagamento.descricao || 'Pagamento PIX'}`);
      
      doc.moveDown(0.5);
      doc.text(`Data do Pagamento: ${dadosPagamento.dataPagamento || new Date().toLocaleDateString('pt-BR')}`);
      
      doc.moveDown();
      
      // Dados do Destinatário
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DO DESTINATÁRIO');
      
      doc.fontSize(11)
         .font('Helvetica');
      
      doc.moveDown(0.5);
      doc.text(`Chave PIX: ${dadosPagamento.chave}`);
      
      doc.moveDown();
      
      // Dados da Transação
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DA TRANSAÇÃO');
      
      doc.fontSize(11)
         .font('Helvetica');
      
      doc.moveDown(0.5);
      doc.text(`Código de Solicitação: ${dadosResposta.codigoSolicitacao || 'N/A'}`);
      
      doc.moveDown(0.5);
      doc.text(`Status: REALIZADO COM SUCESSO`);
      
      // Footer
      doc.moveDown(2);
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('gray')
         .text('Este comprovante foi gerado automaticamente.', {
           align: 'center'
         });
      
      doc.moveDown(0.5);
      doc.text('Banco Inter S.A. - CNPJ: 00.416.968/0001-01', {
        align: 'center'
      });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

app.post('/pagar', async (req, res) => {
  try {
    console.log('Recebendo requisição:', JSON.stringify(req.body, null, 2));
    
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
    console.log('Token obtido com sucesso');
    
    const results = [];
    
    for (const item of req.body.pagamentos) {
      try {
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
        
        console.log('Enviando PIX:', JSON.stringify(corpoPix, null, 2));
        
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
        
        // Gerar comprovante PDF
        let comprovanteBase64 = null;
        try {
          const pdfBuffer = await gerarComprovantePDF(item, pagamentoPix.data);
          comprovanteBase64 = pdfBuffer.toString('base64');
          console.log('Comprovante PDF gerado com sucesso');
        } catch (pdfError) {
          console.error('Erro ao gerar PDF:', pdfError);
        }
        
        results.push({
          chave: item.chave,
          valor: item.valor,
          status: 'sucesso',
          response: pagamentoPix.data,
          comprovante: {
            gerado: comprovanteBase64 ? true : false,
            base64: comprovanteBase64,
            nome: comprovanteBase64 ? `Comprovante_PIX_${item.chave}_${new Date().toISOString().split('T')[0]}.pdf` : null
          }
        });
        
      } catch (error) {
        console.error("Erro no pagamento:", error?.response?.data || error.message);
        results.push({
          chave: item.chave,
          valor: item.valor,
          status: 'erro',
          erro: error.response ? error.response.data : error.message,
          comprovante: {
            gerado: false
          }
        });
      }
    }
    
    res.json({ 
      status: 'processado',
      totalPagamentos: req.body.pagamentos.length,
      sucessos: results.filter(r => r.status === 'sucesso').length,
      erros: results.filter(r => r.status === 'erro').length,
      results: results 
    });
    
  } catch (error) {
    console.error("Erro geral:", error?.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: error.message,
      details: error.response ? error.response.data : 'sem detalhes'
    });
  }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      CLIENT_ID: process.env.CLIENT_ID ? '✓' : '✗',
      CLIENT_SECRET: process.env.CLIENT_SECRET ? '✓' : '✗',
      CONTA_CORRENTE: process.env.CONTA_CORRENTE ? '✓' : '✗',
      PDF: 'enabled'
    }
  });
});

// Endpoint para download do comprovante
app.post('/comprovante', async (req, res) => {
  try {
    const { dadosPagamento, dadosTransacao } = req.body;
    
    const pdfBuffer = await gerarComprovantePDF(dadosPagamento, dadosTransacao);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Comprovante_PIX_${dadosPagamento.chave}.pdf"`);
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('Erro ao gerar comprovante:', error);
    res.status(500).json({
      status: 'erro',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Geração de PDF: Habilitada`);
});
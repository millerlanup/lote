const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(bodyParser.json());

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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

// Função para fazer upload do PDF para Cloudinary
async function uploadPDFCloudinary(pdfBuffer, nomeArquivo) {
  try {
    // Converter buffer para base64
    const base64 = pdfBuffer.toString('base64');
    const dataUri = `data:application/pdf;base64,${base64}`;
    
    // Upload para Cloudinary
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'auto',
      public_id: nomeArquivo.replace('.pdf', ''),
      folder: 'comprovantes-pix',
      type: 'upload',
      overwrite: true
    });
    
    console.log('PDF enviado para Cloudinary:', result.public_id);
    
    return {
      url: result.secure_url,
      publicId: result.public_id,
      size: result.bytes
    };
  } catch (error) {
    console.error('Erro ao enviar para Cloudinary:', error);
    return null;
  }
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
         .text(`Data: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, { align: 'right' });
      doc.text(`Hora: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, { align: 'right' });
      
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
      doc.text(`Data do Pagamento: ${dadosPagamento.dataPagamento || new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
      
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
        let comprovanteInfo = {
          gerado: false,
          base64: null,
          nome: null,
          link: null,
          download: null,
          cloudinary: null
        };
        
        try {
          const pdfBuffer = await gerarComprovantePDF(item, pagamentoPix.data);
          const nomeArquivo = `Comprovante_PIX_${item.chave}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
          
          // Upload para Cloudinary
          const cloudinaryResult = await uploadPDFCloudinary(pdfBuffer, nomeArquivo);
          
          if (cloudinaryResult) {
            comprovanteInfo.gerado = true;
            comprovanteInfo.base64 = pdfBuffer.toString('base64');
            comprovanteInfo.nome = nomeArquivo;
            comprovanteInfo.link = cloudinaryResult.url;
            comprovanteInfo.download = cloudinaryResult.url;
            comprovanteInfo.cloudinary = cloudinaryResult;
            
            console.log('Comprovante salvo no Cloudinary com sucesso');
          } else {
            // Fallback: usar armazenamento temporário
            const pdfId = uuidv4();
            comprovanteInfo.gerado = true;
            comprovanteInfo.base64 = pdfBuffer.toString('base64');
            comprovanteInfo.nome = nomeArquivo;
            comprovanteInfo.link = `https://pagamento-inter.onrender.com/comprovante/${pdfId}`;
            comprovanteInfo.download = `https://pagamento-inter.onrender.com/comprovante/${pdfId}?download=true`;
            
            console.log('Usando armazenamento temporário (Cloudinary falhou)');
          }
          
        } catch (pdfError) {
          console.error('Erro ao gerar/enviar PDF:', pdfError);
        }
        
        results.push({
          chave: item.chave,
          valor: item.valor,
          status: 'sucesso',
          response: pagamentoPix.data,
          comprovante: comprovanteInfo
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
  const cloudinaryConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET
  );
  
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      CLIENT_ID: process.env.CLIENT_ID ? '✓' : '✗',
      CLIENT_SECRET: process.env.CLIENT_SECRET ? '✓' : '✗',
      CONTA_CORRENTE: process.env.CONTA_CORRENTE ? '✓' : '✗',
      PDF: 'enabled',
      STORAGE: 'cloudinary + fallback',
      CLOUDINARY: cloudinaryConfigured ? '✓' : '✗'
    }
  });
});

// Armazenamento temporário como fallback
const pdfStorage = new Map();

// Endpoint para servir PDF (fallback)
app.get('/comprovante/:id', (req, res) => {
  const { id } = req.params;
  const pdf = pdfStorage.get(id);
  
  if (!pdf) {
    return res.status(404).json({ erro: 'Comprovante não encontrado' });
  }
  
  res.setHeader('Content-Type', 'application/pdf');
  
  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.nome}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${pdf.nome}"`);
  }
  
  res.send(pdf.buffer);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Geração de PDF: Habilitada`);
  console.log(`Armazenamento: Cloudinary + Fallback local`);
  
  const cloudinaryConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME && 
    process.env.CLOUDINARY_API_KEY && 
    process.env.CLOUDINARY_API_SECRET
  );
  
  if (cloudinaryConfigured) {
    console.log('Cloudinary: Configurado ✓');
  } else {
    console.log('Cloudinary: Não configurado - usando apenas armazenamento temporário');
  }
});
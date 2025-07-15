const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(bodyParser.json());

// Certificados Inter
const cert = fs.readFileSync('./Inter API_Certificado.crt');
const key = fs.readFileSync('./Inter API_Chave.key');
const httpsAgent = new https.Agent({
  cert,
  key,
  rejectUnauthorized: false
});

// Configuração Google Drive
const drive = google.drive('v3');
const auth = new google.auth.GoogleAuth({
  keyFile: './google-credentials.json', // Arquivo de credenciais do Google
  scopes: ['https://www.googleapis.com/auth/drive.file']
});

// Função para detectar tipo de chave (mantida do código anterior)
function detectarTipoChave(chave) {
  const chaveClean = chave.replace(/[.\-\/@]/g, '');
  
  if (/^\d{11}$/.test(chaveClean)) return 'CPF';
  if (/^\d{14}$/.test(chaveClean)) return 'CNPJ';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) return 'EMAIL';
  if (/^(\+55)?\d{10,11}$/.test(chaveClean) || /^\d{10,11}$/.test(chaveClean)) return 'TELEFONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave)) return 'ALEATORIA';
  
  return 'CPF';
}

// Função para formatar valores em Real
function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor);
}

// Função para formatar CPF/CNPJ
function formatarDocumento(doc) {
  const limpo = doc.replace(/\D/g, '');
  if (limpo.length === 11) {
    return limpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  } else if (limpo.length === 14) {
    return limpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return doc;
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
      
      // Valor
      doc.moveDown(0.5);
      doc.text(`Valor: ${formatarMoeda(dadosPagamento.valor)}`, 50, doc.y, { 
        continued: false,
        width: 500
      });
      
      // Descrição
      doc.moveDown(0.5);
      doc.text(`Descrição: ${dadosPagamento.descricao || 'Pagamento PIX'}`);
      
      // Data do pagamento
      doc.moveDown(0.5);
      const dataPag = new Date(dadosPagamento.dataPagamento);
      doc.text(`Data do Pagamento: ${dataPag.toLocaleDateString('pt-BR')}`);
      
      doc.moveDown();
      
      // Dados do Destinatário
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DO DESTINATÁRIO');
      
      doc.fontSize(11)
         .font('Helvetica');
      
      // Tipo e chave
      doc.moveDown(0.5);
      const tipoChave = dadosPagamento.tipoChave || detectarTipoChave(dadosPagamento.chave);
      doc.text(`Tipo de Chave: ${tipoChave}`);
      
      doc.moveDown(0.5);
      let chaveFormatada = dadosPagamento.chave;
      if (tipoChave === 'CPF' || tipoChave === 'CNPJ') {
        chaveFormatada = formatarDocumento(dadosPagamento.chave);
      }
      doc.text(`Chave PIX: ${chaveFormatada}`);
      
      doc.moveDown();
      
      // Dados da Transação
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DA TRANSAÇÃO');
      
      doc.fontSize(11)
         .font('Helvetica');
      
      // Código da transação
      doc.moveDown(0.5);
      doc.text(`Código de Solicitação: ${dadosResposta.codigoSolicitacao || 'N/A'}`);
      
      doc.moveDown(0.5);
      doc.text(`ID End-to-End: ${dadosResposta.e2eid || dadosResposta.endToEndId || 'N/A'}`);
      
      doc.moveDown(0.5);
      doc.text(`Status: ${dadosResposta.status === 'REALIZADO' ? 'Realizado com Sucesso' : dadosResposta.status}`);
      
      // Footer
      doc.moveDown(2);
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor('gray')
         .text('Este comprovante foi gerado automaticamente pelo sistema de pagamentos.', {
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

// Função para salvar no Google Drive
async function salvarComprovanteDrive(pdfBuffer, nomeArquivo, pastaId) {
  try {
    const authClient = await auth.getClient();
    google.options({ auth: authClient });
    
    const fileMetadata = {
      name: nomeArquivo,
      mimeType: 'application/pdf'
    };
    
    if (pastaId) {
      fileMetadata.parents = [pastaId];
    }
    
    const media = {
      mimeType: 'application/pdf',
      body: require('stream').Readable.from(pdfBuffer)
    };
    
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink, webContentLink'
    });
    
    // Tornar o arquivo público (opcional)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Erro ao salvar no Drive:', error);
    throw error;
  }
}

// Endpoint principal de pagamento com geração de comprovante
app.post('/pagar', async (req, res) => {
  try {
    console.log('Recebendo requisição:', JSON.stringify(req.body, null, 2));
    
    // Obter token
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
    const pastaId = req.body.pastaGoogleDrive || process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    for (const [index, item] of req.body.pagamentos.entries()) {
      try {
        // Processar pagamento (código anterior mantido)
        const tipoChave = item.tipoChave || detectarTipoChave(item.chave);
        const chaveFormatada = formatarChave(item.chave, tipoChave);
        
        const valorNumerico = typeof item.valor === 'string' 
          ? parseFloat(item.valor) 
          : item.valor;
        
        const corpoPix = {
          valor: valorNumerico.toFixed(2),
          descricao: item.descricao || 'Pagamento via API Inter',
          dataPagamento: item.dataPagamento,
          chave: chaveFormatada
        };
        
        console.log(`Enviando pagamento ${index + 1}:`, JSON.stringify(corpoPix, null, 2));
        
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
        const dadosComprovante = {
          ...item,
          valor: valorNumerico,
          tipoChave: tipoChave
        };
        
        const pdfBuffer = await gerarComprovantePDF(dadosComprovante, pagamentoPix.data);
        
        // Nome do arquivo
        const dataHora = new Date().toISOString().replace(/[:.]/g, '-');
        const nomeArquivo = `Comprovante_PIX_${item.chave}_${dataHora}.pdf`;
        
        // Salvar no Google Drive
        let driveFile = null;
        if (pastaId) {
          try {
            driveFile = await salvarComprovanteDrive(pdfBuffer, nomeArquivo, pastaId);
            console.log(`Comprovante salvo no Drive: ${driveFile.webViewLink}`);
          } catch (driveError) {
            console.error('Erro ao salvar no Drive, continuando...', driveError);
          }
        }
        
        results.push({
          chave: item.chave,
          tipoChave: tipoChave,
          valor: valorNumerico,
          status: 'sucesso',
          response: pagamentoPix.data,
          comprovante: {
            gerado: true,
            googleDrive: driveFile ? {
              id: driveFile.id,
              nome: driveFile.name,
              link: driveFile.webViewLink,
              download: driveFile.webContentLink
            } : null
          }
        });
        
        console.log(`Pagamento ${index + 1} realizado com sucesso`);
        
      } catch (itemError) {
        console.error(`Erro no pagamento ${index + 1}:`, itemError.response?.data || itemError.message);
        
        results.push({
          chave: item.chave,
          valor: item.valor,
          status: 'erro',
          erro: itemError.response?.data || itemError.message,
          comprovante: {
            gerado: false
          }
        });
      }
      
      // Delay entre pagamentos
      if (index < req.body.pagamentos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    const resumo = {
      status: 'processado',
      totalPagamentos: req.body.pagamentos.length,
      sucessos: results.filter(r => r.status === 'sucesso').length,
      erros: results.filter(r => r.status === 'erro').length,
      results
    };
    
    console.log('Processamento concluído:', JSON.stringify(resumo, null, 2));
    res.json(resumo);
    
  } catch (error) {
    console.error("Erro geral:", error?.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: error.message,
      details: error.response ? error.response.data : 'sem detalhes'
    });
  }
});

// Endpoint para gerar comprovante de pagamento já realizado
app.post('/gerar-comprovante', async (req, res) => {
  try {
    const { dadosPagamento, dadosTransacao, pastaGoogleDrive } = req.body;
    
    // Gerar PDF
    const pdfBuffer = await gerarComprovantePDF(dadosPagamento, dadosTransacao);
    
    // Nome do arquivo
    const dataHora = new Date().toISOString().replace(/[:.]/g, '-');
    const nomeArquivo = `Comprovante_PIX_${dadosPagamento.chave}_${dataHora}.pdf`;
    
    // Salvar no Google Drive se solicitado
    let driveFile = null;
    if (pastaGoogleDrive || process.env.GOOGLE_DRIVE_FOLDER_ID) {
      driveFile = await salvarComprovanteDrive(
        pdfBuffer, 
        nomeArquivo, 
        pastaGoogleDrive || process.env.GOOGLE_DRIVE_FOLDER_ID
      );
    }
    
    // Retornar o PDF como resposta se não for salvo no Drive
    if (!driveFile) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      res.send(pdfBuffer);
    } else {
      res.json({
        status: 'sucesso',
        comprovante: {
          nome: nomeArquivo,
          googleDrive: {
            id: driveFile.id,
            link: driveFile.webViewLink,
            download: driveFile.webContentLink
          }
        }
      });
    }
    
  } catch (error) {
    console.error('Erro ao gerar comprovante:', error);
    res.status(500).json({
      status: 'erro',
      message: error.message
    });
  }
});

// Função auxiliar para formatar chave
function formatarChave(chave, tipoChave) {
  const chaveClean = chave.replace(/[.\-\/@]/g, '');
  
  switch(tipoChave) {
    case 'CPF':
    case 'CNPJ':
      return chaveClean;
    case 'TELEFONE':
      if (!chaveClean.startsWith('+55') && !chaveClean.startsWith('55')) {
        return '+55' + chaveClean;
      }
      return chaveClean.startsWith('+') ? chaveClean : '+' + chaveClean;
    case 'EMAIL':
      return chave.toLowerCase().trim();
    case 'ALEATORIA':
      return chave.trim();
    default:
      return chave.trim();
  }
}

// Endpoints auxiliares
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      inter: {
        CLIENT_ID: process.env.CLIENT_ID ? '✓' : '✗',
        CLIENT_SECRET: process.env.CLIENT_SECRET ? '✓' : '✗',
        CONTA_CORRENTE: process.env.CONTA_CORRENTE ? '✓' : '✗'
      },
      googleDrive: {
        credentials: fs.existsSync('./google-credentials.json') ? '✓' : '✗',
        defaultFolder: process.env.GOOGLE_DRIVE_FOLDER_ID ? '✓' : '✗'
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('Sistema de Comprovantes PIX ativado');
  console.log('Serviços disponíveis:');
  console.log('- Geração de PDF');
  console.log('- Integração Google Drive');
});
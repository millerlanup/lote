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

// Log para verificar se PDFKit está disponível
console.log('PDFDocument disponível?', typeof PDFDocument);

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

// Função auxiliar para formatar CPF/CNPJ
function formatarCpfCnpj(documento) {
  if (!documento) return '***.***.***-**';
  
  const numeros = documento.replace(/\D/g, '');
  
  if (numeros.length === 11) {
    return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  } else if (numeros.length === 14) {
    return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  
  return '***.***.***-**';
}

// Função para fazer upload do PDF para Cloudinary
async function uploadPDFCloudinary(pdfBuffer, nomeArquivo) {
  try {
    const base64 = pdfBuffer.toString('base64');
    const dataUri = `data:application/pdf;base64,${base64}`;
    
    const result = await cloudinary.uploader.upload(dataUri, {
      resource_type: 'raw',
      public_id: nomeArquivo.replace('.pdf', ''),
      folder: 'comprovantes-pix',
      type: 'upload',
      access_mode: 'public',
      overwrite: true
    });
    
    await cloudinary.uploader.explicit(result.public_id, {
      type: 'upload',
      resource_type: 'raw',
      access_mode: 'public'
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

// Função para gerar PDF do comprovante com layout melhorado
async function gerarComprovantePDF(dadosPagamento, dadosResposta) {
  return new Promise((resolve, reject) => {
    try {
      console.log('=== INICIANDO GERAÇÃO DE PDF PROFISSIONAL ===');
      
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4'
      });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        console.log('PDF profissional finalizado');
        resolve(Buffer.concat(chunks));
      });
      
      // Cores do tema
      const corPrimaria = '#1E3A5F';
      const corSecundaria = '#4B7BEC';
      const corTexto = '#2C3E50';
      const corCinza = '#7F8C8D';
      const corVerde = '#27AE60';
      const corFundo = '#F8F9FA';
      const corBorda = '#E9ECEF';
      
      // Header com fundo azul
      doc.rect(0, 0, doc.page.width, 120)
         .fill(corPrimaria);
      
      // Logo LANUP
      doc.fontSize(32)
         .fillColor('white')
         .font('Helvetica-Bold')
         .text('LANUP', 50, 40);
      
      doc.fontSize(12)
         .fillColor('white')
         .font('Helvetica')
         .text('Intermediário de Pagamentos', 50, 75);
      
      // Título
      doc.fontSize(16)
         .fillColor('white')
         .font('Helvetica-Bold')
         .text('COMPROVANTE DE TRANSFERÊNCIA PIX', 280, 50);
      
      // Box principal com status
      doc.rect(30, 140, doc.page.width - 60, 100)
         .fillAndStroke(corFundo, corBorda);
      
      // Status de sucesso
      doc.fontSize(14)
         .fillColor(corVerde)
         .font('Helvetica-Bold')
         .text('✓ TRANSFERÊNCIA REALIZADA COM SUCESSO', 50, 160);
      
      // Valor
      doc.fontSize(28)
         .fillColor(corPrimaria)
         .font('Helvetica-Bold')
         .text(formatarMoeda(dadosPagamento.valor), 50, 190);
      
      // Data e hora
      const dataHora = new Date().toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        day: '2d',
        month: '2d', 
        year: 'numeric',
        hour: '2d',
        minute: '2d',
        second: '2d'
      });
      
      doc.fontSize(10)
         .fillColor(corCinza)
         .font('Helvetica')
         .text(`Data/Hora: ${dataHora}`, 400, 160);
      
      doc.text(`Código: ${dadosResposta.codigoSolicitacao || 'N/A'}`, 400, 175);
      
      // DADOS DO REMETENTE
      doc.fontSize(12)
         .fillColor(corPrimaria)
         .font('Helvetica-Bold')
         .text('DADOS DO REMETENTE', 50, 270);
      
      doc.moveTo(50, 285)
         .lineTo(550, 285)
         .stroke(corSecundaria);
      
      const coluna1X = 50;
      const coluna2X = 300;
      let yPos = 300;
      
      doc.fontSize(9)
         .fillColor(corCinza)
         .font('Helvetica')
         .text('INSTITUIÇÃO FINANCEIRA', coluna1X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('LANUP PAGAMENTOS S.A.', coluna1X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('CNPJ', coluna1X, yPos + 35);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('XX.XXX.XXX/0001-XX', coluna1X, yPos + 47);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('AGÊNCIA / CONTA', coluna2X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('0001 / 47775967', coluna2X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('NOME', coluna2X, yPos + 35);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('LANUP SERVIÇOS E CONSULTORIA LTDA', coluna2X, yPos + 47);
      
      // DADOS DO DESTINATÁRIO
      yPos = 380;
      doc.fontSize(12)
         .fillColor(corPrimaria)
         .font('Helvetica-Bold')
         .text('DADOS DO DESTINATÁRIO', 50, yPos);
      
      doc.moveTo(50, yPos + 15)
         .lineTo(550, yPos + 15)
         .stroke(corSecundaria);
      
      yPos += 30;
      
      doc.fontSize(9)
         .fillColor(corCinza)
         .font('Helvetica')
         .text('INSTITUIÇÃO FINANCEIRA', coluna1X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('BANCO INTER S.A.', coluna1X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('CHAVE PIX', coluna2X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text(dadosPagamento.chave, coluna2X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('NOME', coluna1X, yPos + 35);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('NOME DO BENEFICIÁRIO', coluna1X, yPos + 47);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('CPF/CNPJ', coluna2X, yPos + 35);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text('***.***.***-**', coluna2X, yPos + 47);
      
      // DADOS DA TRANSFERÊNCIA
      yPos = 490;
      doc.fontSize(12)
         .fillColor(corPrimaria)
         .font('Helvetica-Bold')
         .text('DADOS DA TRANSFERÊNCIA', 50, yPos);
      
      doc.moveTo(50, yPos + 15)
         .lineTo(550, yPos + 15)
         .stroke(corSecundaria);
      
      yPos += 30;
      
      doc.fontSize(9)
         .fillColor(corCinza)
         .font('Helvetica');
      
      // Duas colunas de informações
      doc.text('VALOR', coluna1X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text(formatarMoeda(dadosPagamento.valor), coluna1X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('DATA/HORA', coluna2X, yPos);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text(dataHora, coluna2X, yPos + 12);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('CÓDIGO DE IDENTIFICAÇÃO', coluna1X, yPos + 35);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text(dadosResposta.codigoSolicitacao || 'N/A', coluna1X, yPos + 47);
      
      doc.fillColor(corCinza)
         .font('Helvetica')
         .text('DESCRIÇÃO', coluna1X, yPos + 70);
      doc.fillColor(corTexto)
         .font('Helvetica-Bold')
         .text(dadosPagamento.descricao || 'Pagamento via PIX', coluna1X, yPos + 82);
      
      // QR Code placeholder
      doc.rect(450, 520, 100, 100)
         .fillAndStroke(corFundo, corBorda);
      
      doc.fontSize(8)
         .fillColor(corCinza)
         .font('Helvetica')
         .text('QR Code', 475, 570, {
           width: 50,
           align: 'center'
         });
      
      // Rodapé
      doc.moveTo(50, 660)
         .lineTo(550, 660)
         .stroke(corBorda);
      
      doc.fontSize(8)
         .fillColor(corCinza)
         .font('Helvetica')
         .text('Comprovante gerado em: ' + dataHora, 50, 675, {
           align: 'center',
           width: 500
         });
      
      doc.text('Este é um comprovante válido de transferência PIX', 50, 690, {
           align: 'center',
           width: 500
         });
      
      doc.text('Central de Atendimento: 0800 123 4567 | www.lanup.com.br', 50, 705, {
           align: 'center',
           width: 500
         });
      
      doc.end();
      
    } catch (error) {
      console.error('Erro na geração do PDF:', error);
      reject(error);
    }
  });
}

// Armazenamento temporário como fallback
const pdfStorage = new Map();

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
          console.log('=== TENTANDO GERAR PDF ===');
          
          const pdfBuffer = await gerarComprovantePDF(item, pagamentoPix.data);
          console.log('✅ PDF gerado com sucesso, tamanho:', pdfBuffer.length, 'bytes');
          
          const nomeArquivo = `Comprovante_PIX_${item.chave}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
          console.log('Nome do arquivo:', nomeArquivo);
          
          // Upload para Cloudinary
          console.log('Iniciando upload para Cloudinary...');
          const cloudinaryResult = await uploadPDFCloudinary(pdfBuffer, nomeArquivo);
          
          if (cloudinaryResult) {
            comprovanteInfo.gerado = true;
            comprovanteInfo.base64 = pdfBuffer.toString('base64').substring(0, 100) + '...';
            comprovanteInfo.nome = nomeArquivo;
            comprovanteInfo.link = cloudinaryResult.url;
            comprovanteInfo.download = cloudinaryResult.url;
            comprovanteInfo.cloudinary = cloudinaryResult;
            
            console.log('✅ Comprovante salvo no Cloudinary:', cloudinaryResult.url);
          } else {
            // Fallback
            const pdfId = uuidv4();
            pdfStorage.set(pdfId, {
              buffer: pdfBuffer,
              nome: nomeArquivo
            });
            
            comprovanteInfo.gerado = true;
            comprovanteInfo.base64 = pdfBuffer.toString('base64').substring(0, 100) + '...';
            comprovanteInfo.nome = nomeArquivo;
            comprovanteInfo.link = `https://pagamento-inter.onrender.com/comprovante/${pdfId}`;
            comprovanteInfo.download = `https://pagamento-inter.onrender.com/comprovante/${pdfId}?download=true`;
            
            console.log('⚠️ Usando armazenamento temporário');
          }
          
        } catch (pdfError) {
          console.error('❌ ERRO AO GERAR/ENVIAR PDF:', pdfError.message);
          comprovanteInfo.erro = {
            mensagem: pdfError.message,
            tipo: pdfError.constructor.name
          };
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
      PDFKIT: typeof PDFDocument !== 'undefined' ? '✓' : '✗',
      STORAGE: 'cloudinary + fallback',
      CLOUDINARY: cloudinaryConfigured ? '✓' : '✗'
    }
  });
});

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
  console.log(`PDFKit disponível: ${typeof PDFDocument !== 'undefined' ? 'SIM' : 'NÃO'}`);
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
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

// Função para determinar o banco baseado no tipo de chave
function identificarBanco(chave, tipoChave) {
  // Esta é uma função simplificada - idealmente consultaria uma API
  // Por enquanto, vamos usar lógica básica
  if (tipoChave === 'EMAIL') {
    if (chave.includes('@nubank')) return 'NUBANK';
    if (chave.includes('@inter')) return 'BANCO INTER S.A.';
  }
  
  // Se não conseguir identificar, retorna genérico
  return 'INSTITUIÇÃO FINANCEIRA';
}

// Função SIMPLES para gerar PDF - PRETO E BRANCO
async function gerarComprovantePDF(dadosPagamento, dadosResposta) {
  return new Promise((resolve, reject) => {
    try {
      console.log('=== GERANDO PDF SIMPLES ===');
      
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4'
      });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        console.log('PDF finalizado');
        resolve(Buffer.concat(chunks));
      });
      
      // Data e hora com timezone correto de São Paulo
      const agora = new Date();
      const dataHoraBrasil = agora.toLocaleString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      // CABEÇALHO
      doc.fontSize(20)
         .font('Helvetica-Bold')
         .text('COMPROVANTE DE PAGAMENTO PIX', { align: 'center' });
      
      doc.fontSize(10)
         .font('Helvetica')
         .text('LANUP - Intermediário de Pagamentos', { align: 'center' });
      
      doc.moveDown(2);
      
      // Linha divisória
      doc.moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();
      
      // SEÇÃO 1: DADOS DA OPERAÇÃO
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DA OPERAÇÃO');
      
      doc.moveDown(0.5);
      
      doc.fontSize(11)
         .font('Helvetica');
      
      doc.text(`Status: PAGAMENTO REALIZADO COM SUCESSO`);
      doc.text(`Valor: ${formatarMoeda(dadosPagamento.valor)}`);
      doc.text(`Data/Hora: ${dataHoraBrasil}`);
      doc.text(`Código de Solicitação: ${dadosResposta.codigoSolicitacao || 'N/A'}`);
      doc.text(`Descrição: ${dadosPagamento.descricao || 'Pagamento via PIX'}`);
      
      doc.moveDown();
      
      // Linha divisória
      doc.moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();
      
      // SEÇÃO 2: DADOS DO PAGADOR (CORRIGIDO)
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DO PAGADOR');
      
      doc.moveDown(0.5);
      
      doc.fontSize(11)
         .font('Helvetica');
      
      doc.text(`Instituição: BANCO INTER S.A.`);
      doc.text(`CNPJ: XX.XXX.XXX/0001-XX`);
      doc.text(`Agência: 0001`);
      doc.text(`Conta: 47775967`);
      doc.text(`Nome: LANUP TECNOLOGIA`); // CORRIGIDO
      
      doc.moveDown();
      
      // Linha divisória
      doc.moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();
      
      // SEÇÃO 3: DADOS DO RECEBEDOR
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('DADOS DO RECEBEDOR');
      
      doc.moveDown(0.5);
      
      doc.fontSize(11)
         .font('Helvetica');
      
      // Identificar banco baseado no tipo de chave
      const bancoRecebedor = dadosPagamento.tipochave ? 
        identificarBanco(dadosPagamento.chave, dadosPagamento.tipochave) : 
        'INSTITUIÇÃO FINANCEIRA';
      
      doc.text(`Instituição: ${bancoRecebedor}`);
      doc.text(`Chave PIX: ${dadosPagamento.chave}`);
      doc.text(`Nome: ${dadosPagamento.nomerecebedor || 'NOME DO BENEFICIÁRIO'}`); // USANDO NOME DA PLANILHA
      doc.text(`CPF/CNPJ: ***.***.***-**`);
      
      doc.moveDown(2);
      
      // Linha divisória final
      doc.moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();
      
      // Rodapé
      doc.fontSize(9)
         .font('Helvetica')
         .text('Este comprovante foi gerado automaticamente.', { align: 'center' });
      doc.text(`Comprovante gerado em: ${dataHoraBrasil}`, { align: 'center' });
      doc.text('LANUP - www.lanup.com.br', { align: 'center' });
      
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
          console.log('Tentando gerar PDF...');
          
          // Adicionar dados extras do pagamento ao item para o PDF
          const dadosParaPDF = {
            ...item,
            nomerecebedor: item.nomerecebedor || item.nome_recebedor || item.nomeRecebedor,
            tipochave: item.tipochave || item.tipo_chave || item.tipoChave
          };
          
          const pdfBuffer = await gerarComprovantePDF(dadosParaPDF, pagamentoPix.data);
          console.log('✅ PDF gerado com sucesso, tamanho:', pdfBuffer.length, 'bytes');
          
          const nomeArquivo = `Comprovante_PIX_${item.chave}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
          
          // Upload para Cloudinary
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
          console.error('❌ ERRO AO GERAR PDF:', pdfError.message);
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
import { v4 } from 'uuid'
import dotenv from 'dotenv'
import express from 'express'
import { Template, Pass } from '@walletpass/pass-js'
import * as passkit from '@walletpass/pass-js'
import superagent from 'superagent'
import sharp from 'sharp'
import path from 'path'

dotenv.config();

// Inicializa um template que será usado para criar outros passes.
const template = new Template('generic', {
    passTypeIdentifier: "pass.br.ufpe.cin.academy.gera",
    teamIdentifier: process.env.APPLE_DEVELOPER_TEAM_ID,
    organizationName: "Gera",
    description: "Cartão de Cobrança Gera",
    logoText: "Gera",
    sharingProhibited: false
  });

const app = express();
const port = process.env.PORT || 8080;
const passes = {};

app.use(express.json());

// Cria um novo passe
app.post('/card/', async (req, res) => {
    try {
        
        const cardType = getNewPassRequestCardType(req.body)

        if (cardType == null) {
            throw new Error('InvalidCardType')
        }

        const pass = template.createPass({
            serialNumber: v4(),
        });

        fillPrimaryField(pass, req.body, cardType)
        fillSecondaryField(pass, req.body.message)
        personalizeCard(pass, req.body)
        generateBarcode(pass, req.body, cardType)
        fillBackFields(pass, req.body)
        await embedImage(pass, req.body.imageUrl)

        passes[pass.serialNumber] = pass;

        res.status(200).type(passkit.constants.PASS_MIME_TYPE).send(await pass.asBuffer());

    } catch (e) {
        res.status(400).json({
            'message': 'Erro ao criar novo cartão.',
            'error': e.toString()
        })
        console.error(e)
    }

});

// Retorna um passe existente
app.get('/card/:uid', async (req, res) => {
    try {
        
        const pass = passes[req.params.uid]
        if (pass == null) {
            throw new Error('PassNotFound')
        }

        res.status(200).type(passkit.constants.PASS_MIME_TYPE).send(await pass.asBuffer());

    } catch (e) {
        res.status(400).json({
            'message': 'Erro ao retornar cartão existente.',
            'error': e.toString()
        })
        console.error(e)
    }
});

app.get('*', (req, res) =>{
    res.status(404).json({
        'message': 'Endpoint não encontrado.',
        'error': 'NotFound'
    });
  });
  

template.setCertificate(Buffer.from(process.env.PASS_CERTIFICATE, 'base64').toString('utf-8')),
template.setPrivateKey(Buffer.from(process.env.PASS_PRIVATE_KEY, 'base64').toString('utf-8'), process.env.PASS_PASSPHRASE)

template.images.load(path.join(__dirname, '../assets/images')).then(() => {
    app.listen(port, () => {
        console.log(`O servidor está escutando em http://localhost:${port}`);
    });
})

enum CardType {
   PicPay = 'picpay',
   Boleto = 'boleto',
   Nubank = 'nubank',
   Febraban = 'febraban' 
}

function getNewPassRequestCardType(body: any): CardType {
    if (body.hasOwnProperty('type') && body.hasOwnProperty('message') && body.hasOwnProperty('recipientName') && body.hasOwnProperty("recipientPhoneNumber")) {
        switch (body.type) {
            
            case CardType.Boleto:
            if (!(
                body.hasOwnProperty('value') &&
                body.hasOwnProperty('boletoDigitableLine') &&
                (body.hasOwnProperty('cpf') || body.hasOwnProperty('cnpj'))
            )) throw new Error('MissingValueOnRequest')
            break;

            case CardType.PicPay:
            if (!(
                body.hasOwnProperty('picpayUser')
            )) throw new Error('MissingValueOnRequest')
            break;
            
            case CardType.Nubank:
            if (!(
                body.hasOwnProperty('nubankUrl')
            )) throw new Error('MissingValueOnRequest')

            case CardType.Febraban:
                if (!(
                    body.hasOwnProperty('bankCode') &&
                    body.hasOwnProperty('bankName') &&
                    body.hasOwnProperty('agencyNumber') &&
                    body.hasOwnProperty('accountNumber') &&
                    body.hasOwnProperty('accountType') &&
                    body.hasOwnProperty('recipientName') &&
                    (body.hasOwnProperty('cpf') || body.hasOwnProperty('cnpj'))
                )) throw new Error('MissingValueOnRequest')
            break;

            default:
                return null
        }
    } else {
        throw new Error('MissingValueOnRequest')
    }

    return body.type as CardType
}

function fillBackFields(pass: Pass, body: any) {
    for (const field in body) {
        if (backLabels[field]) {
            pass.backFields.add({
                label: backLabels[field],
                key: field,
                value: body[field]
            })
        }
    }

    pass.backFields.add({
        label: "Suporte do App Gera",
        key: 'supportMail',
        value: process.env.CONTACT_EMAIL
    })

    return pass
}

function fillPrimaryField(pass: Pass, body: any, cardType: CardType) {

    if (body.hasOwnProperty('value') && Number(body.value)) {
        pass.primaryFields.add({
            key: "value",
            label: "Valor",
            value: Number(body.value),
            currencyCode: "BRL"
        })
        return pass
    }

    if (cardType === CardType.PicPay) {
        pass.primaryFields.add({
            key: "value",
            label: "Usuário do PicPay",
            value: body.picpayUser
        })
        return pass
    }

    pass.primaryFields.add({
        key: "value",
        label: "Destinatário",
        value: body.recipientName
    })
    return pass

}

function fillSecondaryField(pass: Pass, message: string) {
    pass.secondaryFields.add({
        key: "message",
        label: "Mensagem",
        value: message,
        textAlignment : "PKTextAlignmentLeft"
    })
    return pass
}

function personalizeCard(pass: Pass, body: any) {
    pass.backgroundColor = body.backgroundColor ?? "rgb(154, 69, 215)"
    pass.foregroundColor = body.foregroundColor ?? "rgb(255, 255, 255)"

    return pass
}

function generateBarcode(pass: Pass, body: any, cardType: CardType) {
    switch (cardType) {
            
        case CardType.Boleto:
            pass.barcodes = [{
                    altText: body.boletoDigitableLine,
                    message: body.boletoDigitableLine.replace(/\D+/g, ''),
                    format: "PKBarcodeFormatCode128",
                    messageEncoding: "iso-8859-1"
            },
            {
                altText: body.boletoDigitableLine,
                message: body.boletoDigitableLine.replace(/\D+/g, ''),
                format: "PKBarcodeFormatQR",
                messageEncoding: "iso-8859-1"
            }]
            return pass

        case CardType.PicPay:
            let picpayUrl = `https://picpay.me/${body.picpayUser}`
            if (body.value) {
                picpayUrl += `/${body.value}`
            }
            pass.barcodes = [{
                altText: picpayUrl,
                message: picpayUrl,
                format: "PKBarcodeFormatQR",
                messageEncoding: "iso-8859-1"
            }]
            return pass
        
        case CardType.Nubank:
            pass.barcodes = [{
                "altText" : body.nubankUrl,
                "message" : body.nubankUrl,
                "format" : "PKBarcodeFormatQR",
                "messageEncoding" : "iso-8859-1"
            }]
            return pass

        case CardType.Febraban:
            pass.barcodes = [{
                "altText" : "Aponte a câmera ⬆️",
                "message" : `${body.bankCode} - ${body.bankName}\n
                             Ag. ${body.agencyNumber}\n
                             Conta ${body.accountNumber}`,
                "format" : "PKBarcodeFormatQR",
                "messageEncoding" : "iso-8859-1"
            }]
            return pass

    }
}

async function embedImage(pass: Pass, imageUrl: string) {

    if (imageUrl) {
        const imageRequest = await superagent.get(imageUrl)
            .maxResponseSize(2097152) // 2MB
            .timeout({
                response: 1000,  // 1 second
                deadline: 2000, // 2 seconds
            }).buffer()

        if (!imageRequest.ok) {
            throw new Error('ImageRequestAborted')
        }

        await pass.images.add('thumbnail', await sharp(imageRequest.body).resize(90, 90, {fit: 'inside'}).removeAlpha().toFormat('png').toBuffer(), '1x')
        await pass.images.add('thumbnail', await sharp(imageRequest.body).resize(180, 180, {fit: 'inside'}).removeAlpha().toFormat('png').toBuffer(), '2x')
        await pass.images.add('thumbnail', await sharp(imageRequest.body).resize(270, 270, {fit: 'inside'}).removeAlpha().toFormat('png').toBuffer(), '3x')

    }
       
    return pass
}

const backLabels = {
    picpayUser: "Usuário do PicPay",
    bankCode: "Código do banco",
    bankName: "Nome do banco",
    agencyNumber: "Número da agência",
    accountNumber: "Número da conta",
    accountType: "Tipo de conta",
    recipientName: "Nome de destinatário",
    recipientPhoneNumber: "Contato de destinatário",
    boletoDigitableLine: "Linha digitável",
    cpf: "CPF",
    cnpj: "CNPJ",
}

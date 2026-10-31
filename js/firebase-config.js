// Cole aqui a configuração do seu app Web do Firebase
// (Console do Firebase > Configurações do projeto > Seus apps > SDK setup and configuration > Config).
// Enquanto apiKey começar com "COLE", o Pago funciona apenas neste dispositivo.
// Esses valores não são segredos: quem protege os dados são as regras do Firestore e a criptografia.
//
// Atenção: o console do Firebase mostra um trecho com "import { initializeApp } from 'firebase/app'"
// e "const app = initializeApp(...)". NÃO copie essas linhas; copie só os valores entre chaves.
// O Pago já carrega o Firebase sozinho.
export const cloudConfig = {
  apiKey: 'COLE_SUA_API_KEY',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  storageBucket: 'seu-projeto.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

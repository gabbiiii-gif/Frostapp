# FrostERP — Build Android (APK / AAB)

Guia passo a passo pra gerar o app Android e publicar na Play Store.

## 1. Pré-requisitos (uma vez)

### Android Studio
1. Baixar: https://developer.android.com/studio (Windows, ~1.2GB)
2. Instalar com SDK padrão (aceitar licenças)
3. Abrir → SDK Manager → instalar:
   - **Android SDK Platform 34** (Android 14)
   - **Android SDK Build-Tools 34.0.0**
   - **Android SDK Command-line Tools (latest)**

### Java JDK 17
Android Studio já vem com JDK embutido. Se preferir global:
- Baixar: https://adoptium.net (Temurin 17 LTS)
- Setar `JAVA_HOME` nas variáveis de ambiente

### Variável ANDROID_HOME (opcional, pra CLI)
```
ANDROID_HOME=C:\Users\T-GAMER\AppData\Local\Android\Sdk
PATH +%ANDROID_HOME%\platform-tools
```

## 2. Build APK Debug (testar no celular)

### Via Android Studio (mais fácil)
```bash
npm run android:open
```
Isso abre o projeto no Android Studio. Aguarda Gradle sync (~3min primeira vez).

Depois:
1. Conecta celular Android via USB com **Depuração USB** ativada (Configurações → Sobre → toca 7x em "Versão de compilação" → volta → Opções do desenvolvedor → Depuração USB)
2. Topo Android Studio: dropdown mostra teu celular
3. Botão ▶ Run → instala e abre APK no celular

### Via CLI (mais rápido se já configurado)
```bash
npm run android:run
```

## 3. Atualizar app após mudar código web

Sempre que mexer em `src/`:
```bash
npm run android:sync
```
Depois roda de novo no Android Studio (▶ Run).

## 4. Build AAB Release (Play Store)

### 4.1 Gerar keystore (UMA VEZ — guardar com vida!)
```bash
keytool -genkey -v -keystore frosterp-release.keystore -alias frosterp -keyalg RSA -keysize 2048 -validity 10000
```
Salva senha em local seguro. **Se perder, perde a app na Play Store** (não dá pra atualizar).

Move keystore pra: `android/frosterp-release.keystore` (já está no .gitignore).

### 4.2 Configurar signing
Cria `android/keystore.properties` (também gitignored):
```properties
storePassword=SUA_SENHA_AQUI
keyPassword=SUA_SENHA_AQUI
keyAlias=frosterp
storeFile=../frosterp-release.keystore
```

Edita `android/app/build.gradle`, adiciona antes de `android {`:
```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Dentro de `android {}`, adiciona:
```gradle
signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

### 4.3 Gerar AAB
No Android Studio:
- Menu **Build → Generate Signed Bundle / APK → Android App Bundle → Next**
- Seleciona keystore criado, preenche senhas
- Variant: **release**
- Finish → AAB gerado em `android/app/release/app-release.aab`

Ou via CLI:
```bash
cd android
./gradlew bundleRelease
```

## 5. Publicar Play Store

### 5.1 Criar conta Google Play Console
- https://play.google.com/console — $25 one-time
- Verificar identidade (CNPJ ou pessoa física)

### 5.2 Criar app
1. **Criar app** → nome "FrostERP", idioma pt-BR, app gratuito
2. Aceitar políticas
3. Configurar:
   - **Acesso ao app:** explicar fluxo login (admin → senha) ou conceder credenciais teste pra revisor
   - **Anúncios:** Não
   - **Classificação de conteúdo:** preencher formulário (resultará em Livre)
   - **Público-alvo:** 18+
   - **Privacidade:** URL https://frosterp.com.br/privacidade (criar página)
   - **Detalhes da loja:** descrição, screenshots, ícone 512x512, gráfico 1024x500

### 5.3 Upload AAB
- **Versão de produção** → Criar versão → upload `app-release.aab`
- Notas da versão (pt-BR + en)
- Enviar para revisão (1-7 dias)

### 5.4 Closed testing primeiro (recomendado)
Antes de produção:
- **Teste fechado** → criar trilha → adicionar emails dos testers
- Tester recebe link Play Store privado, instala app
- 14 dias de teste mínimo recomendado pelo Google

## 6. Atualizar app depois de publicado

Toda nova versão precisa **bumpar versionCode**:
- `android/app/build.gradle`:
  ```gradle
  versionCode 2  // sempre incrementar
  versionName "1.0.1"
  ```
- Build novo AAB → upload nova versão Play Console

## Troubleshooting

| Erro | Solução |
|---|---|
| "SDK location not found" | Cria `android/local.properties` com `sdk.dir=C:\\Users\\T-GAMER\\AppData\\Local\\Android\\Sdk` |
| Gradle sync trava | Wifi corporativo bloqueia. Tenta hotspot 4G. |
| "INSTALL_FAILED_USER_RESTRICTED" | Celular Xiaomi/MIUI: ativar "Instalar via USB" nas opções dev |
| App branco ao abrir | Roda `npm run android:sync` de novo, confirma `dist/` foi copiado |
| Camera não abre | Confirma permissões no Manifest + pede permissão runtime no código |

## Próximos passos depois do APK funcionando

1. Push notifications (FCM) — notificar técnico de OS atribuída
2. Biometria login (Touch/Face ID via `@capacitor-community/biometric-auth`)
3. Deep links: `frosterp://os/{id}` abre detalhe direto
4. Modo offline robusto (já funciona via PWA, validar fluxo Capacitor)
5. iOS via GitHub Actions (build cloud free)

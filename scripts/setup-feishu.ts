/**
 * Setup Feishu credentials for sidecar mode
 * 
 * Usage:
 *   bun run scripts/setup-feishu.ts
 * 
 * Options:
 *   --qr          Use QR code registration (generates new PersonalAgent)
 *   --manual      Manually input app_id and app_secret
 *   --test        Use test credentials (for local testing)
 *   --show        Show current credentials
 */

import { ConfigManager } from '../src/core/config';
import { startRegistration, getRegistration } from '../src/channels/feishu-register';

async function showCurrent() {
  const cm = new ConfigManager();
  const appId = cm.get('feishu_app_id');
  const secret = cm.get('feishu_app_secret');
  const domain = cm.get('feishu_domain');

  console.log('\n📋 Current Feishu Configuration:');
  console.log('───────────────────────────────────────');
  console.log(`App ID:  ${appId || '(not set)'}`);
  console.log(`Secret:  ${secret ? '***' + secret.slice(-4) : '(not set)'}`);
  console.log(`Domain:  ${domain || 'feishu'}`);
  console.log('───────────────────────────────────────\n');
}

async function setupManual() {
  console.log('\n🔧 Manual Credential Setup');
  console.log('───────────────────────────────────────');
  console.log('Please enter your Feishu/Lark app credentials.');
  console.log('You can find them at: https://open.feishu.cn/app');
  console.log('───────────────────────────────────────\n');

  const appId = await prompt('App ID (cli_xxx): ');
  const appSecret = await prompt('App Secret: ');
  const domain = await prompt('Domain (feishu/lark) [feishu]: ') || 'feishu';

  if (!appId || !appSecret) {
    console.error('❌ App ID and Secret are required');
    process.exit(1);
  }

  const cm = new ConfigManager();
  cm.set('feishu_app_id', appId.trim());
  cm.set('feishu_app_secret', appSecret.trim());
  cm.set('feishu_domain', domain.trim());

  console.log('\n✅ Credentials saved to SQLite!');
  console.log('   Restart the server to apply changes.\n');
}

async function setupQR() {
  console.log('\n📱 QR Code Registration');
  console.log('───────────────────────────────────────');
  console.log('This will create a new PersonalAgent bot via Feishu QR code.');
  console.log('───────────────────────────────────────\n');

  try {
    const reg = await startRegistration('prod');
    console.log('⏳ Registration started!');
    console.log(`   Device Code: ${reg.deviceCode}`);
    console.log(`   QR URL: ${reg.qrUrl}`);
    console.log(`   Expires in: ${reg.expiresIn}s\n`);
    console.log('📲 Please scan the QR code with Feishu app to authorize.\n');

    // Poll for result
    const startTime = Date.now();
    const check = setInterval(() => {
      const current = getRegistration(reg.deviceCode);
      if (!current) return;

      if (current.status === 'success') {
        clearInterval(check);
        console.log('✅ Registration successful!');
        console.log(`   App ID: ${current.appId}`);
        console.log(`   User: ${current.userOpenId}`);
        console.log(`   Domain: ${current.domain}\n`);

        // Save to config
        const cm = new ConfigManager();
        if (current.appId && current.appSecret) {
          cm.set('feishu_app_id', current.appId);
          cm.set('feishu_app_secret', current.appSecret);
          if (current.domain) {
            cm.set('feishu_domain', current.domain);
          }
          console.log('✅ Credentials saved to SQLite!');
          console.log('   Restart the server to apply changes.\n');
        }
      } else if (current.status === 'expired') {
        clearInterval(check);
        console.log('❌ Registration expired. Please try again.\n');
      } else if (current.status === 'denied') {
        clearInterval(check);
        console.log('❌ Registration denied by user.\n');
      } else if (current.status === 'error') {
        clearInterval(check);
        console.log(`❌ Registration error: ${current.error}\n`);
      }

      // Timeout
      if (Date.now() - startTime > (reg.expiresIn + 10) * 1000) {
        clearInterval(check);
        console.log('❌ Registration timed out.\n');
      }
    }, 2000);
  } catch (err) {
    console.error('❌ Registration failed:', err);
  }
}

function prompt(question: string): Promise<string> {
  const { createInterface } = require('readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--show')) {
    await showCurrent();
    return;
  }

  if (args.includes('--manual')) {
    await setupManual();
    return;
  }

  if (args.includes('--qr')) {
    await setupQR();
    return;
  }

  if (args.includes('--test')) {
    const cm = new ConfigManager();
    cm.set('feishu_app_id', 'cli_test123');
    cm.set('feishu_app_secret', 'test_secret');
    cm.set('feishu_domain', 'feishu');
    console.log('✅ Test credentials set.\n');
    return;
  }

  // Interactive menu
  console.log('\n🤖 Feishu Sidecar Setup');
  console.log('═══════════════════════════════════════');
  console.log('1. 📱 QR Code Registration (Recommended)');
  console.log('2. 🔧 Manual Credential Input');
  console.log('3. 📋 Show Current Credentials');
  console.log('4. 🧪 Use Test Credentials');
  console.log('0. ❌ Cancel');
  console.log('═══════════════════════════════════════');

  const choice = await prompt('\nSelect option: ');

  switch (choice) {
    case '1': await setupQR(); break;
    case '2': await setupManual(); break;
    case '3': await showCurrent(); break;
    case '4': {
      const cm = new ConfigManager();
      cm.set('feishu_app_id', 'cli_test123');
      cm.set('feishu_app_secret', 'test_secret');
      cm.set('feishu_domain', 'feishu');
      console.log('✅ Test credentials set.\n');
      break;
    }
    case '0':
    default:
      console.log('Cancelled.\n');
  }
}

main().catch(console.error);

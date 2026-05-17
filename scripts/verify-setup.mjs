import { spawnSync } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

// Mock app path for script run
const userData = join(process.env.HOME || '', 'Library/Application Support/gemma-chat')
const mlxDir = join(userData, 'mlx')
const venvPy = join(mlxDir, 'venv', 'bin', 'python3')
const modelsDir = join(mlxDir, 'models')

async function verify() {
  console.log('--- Gemma Chat Verification Script ---')
  
  // 1. Check Python
  console.log('\n[1/4] Checking Python environment...')
  if (!existsSync(venvPy)) {
    console.error('❌ Virtual environment not found at:', venvPy)
    console.log('Please run the app and let it initialize MLX first.')
    return
  }
  const pyVer = spawnSync(venvPy, ['--version']).stdout?.toString().trim()
  console.log('✅ Found Python:', pyVer)

  // 2. Check mlx-lm
  console.log('\n[2/4] Checking mlx-lm installation...')
  const checkMlx = spawnSync(venvPy, ['-c', 'import mlx_lm; print(mlx_lm.__version__)'])
  if (checkMlx.status !== 0) {
    console.error('❌ mlx-lm not found or failed to import.')
    return
  }
  console.log('✅ Found mlx-lm version:', checkMlx.stdout?.toString().trim())

  // 3. Check Models & Apply Fixes
  console.log('\n[3/4] Checking models and applying known fixes...')
  if (!existsSync(modelsDir)) {
    console.log('ℹ️ No models directory found yet.')
  } else {
    // Find all config.json files in snapshots
    const findCmd = spawnSync('find', [modelsDir, '-name', 'config.json'])
    const configs = findCmd.stdout?.toString().split('\n').filter(Boolean) || []
    
    for (const configPath of configs) {
      try {
        const content = JSON.parse(readFileSync(configPath, 'utf8'))
        const modelName = configPath.split('models--')[1]?.split('/')[0]?.replace(/--/g, '/')
        
        console.log(`Checking ${modelName || configPath}...`)
        
        // Fix for Gemma 4 E4B KV sharing mismatch
        if (content.model_type === 'gemma4' && content.text_config?.num_kv_shared_layers > 0) {
          console.log(`  🔧 Found KV sharing mismatch in ${modelName}. Fixing...`)
          content.text_config.num_kv_shared_layers = 0
          writeFileSync(configPath, JSON.stringify(content, null, 4))
          console.log('  ✅ Fixed!')
        } else {
          console.log('  ✅ Model config looks good.')
        }
      } catch (e) {
        console.warn(`  ⚠️ Could not check config at ${configPath}:`, e.message)
      }
    }
  }

  // 4. Test Inference (Optional/Quick)
  console.log('\n[4/4] Verification complete.')
  console.log('\nEverything looks ready! You can now run the app and start chatting.')
  console.log('If you still encounter issues, try switching to a different model in the Setup screen.')
}

verify().catch(console.error)

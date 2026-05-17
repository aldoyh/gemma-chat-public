import { app } from 'electron';
import { MLXBackend } from './src/main/inference/mlx-backend';
import { AVAILABLE_MODELS } from './src/shared/types';
async function runTest() {
    console.log('--- Inference Test Start ---');
    try {
        const backend = new MLXBackend();
        console.log('1. Initializing backend...');
        await backend.initialize();
        const status = await backend.getStatus();
        console.log('Status:', status);
        if (!status.installed) {
            console.log('2. Installing MLX...');
            await backend.install((p) => {
                console.log(`[Install] ${p.stage}: ${p.message}`);
            });
        }
        else {
            console.log('2. MLX already installed.');
        }
        const model = AVAILABLE_MODELS[0]; // E2B (1.5GB)
        console.log(`3. Loading model: ${model.name}...`);
        await backend.loadModel(model.name, (p) => {
            if (p.progress !== undefined) {
                console.log(`[Load] ${p.message} (${Math.round(p.progress * 100)}%)`);
            }
            else {
                console.log(`[Load] ${p.message}`);
            }
        });
        console.log('4. Sending test question...');
        const prompt = 'Hello, who are you? Answer in one short sentence.';
        console.log(`Question: ${prompt}`);
        process.stdout.write('Response: ');
        let fullResponse = '';
        const stream = backend.chat({
            model: model.name,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
        });
        for await (const chunk of stream) {
            if (chunk.content) {
                process.stdout.write(chunk.content);
                fullResponse += chunk.content;
            }
            if (chunk.done)
                break;
        }
        console.log('\n\n--- Test Success ---');
        console.log('Full response length:', fullResponse.length);
        await backend.shutdown();
        app.quit();
    }
    catch (e) {
        console.error('\n--- Test Failed ---');
        console.error(e);
        app.quit();
        process.exit(1);
    }
}
app.whenReady().then(runTest);

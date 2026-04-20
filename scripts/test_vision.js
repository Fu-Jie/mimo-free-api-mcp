const fs = require('fs');
const axios = require('axios');

async function testVision() {
    try {
        // 读取 Python 生成的红蓝双色小图 (256x256)
        const imagePath = '/tmp/red_blue.png';
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        const response = await axios.post('http://127.0.0.1:8001/v1/chat/completions', {
            model: "mimo-v2-omni",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "这张图里有什么内容？" },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ]
                }
            ],
            stream: true
        }, {
            headers: {
                'Authorization': 'Bearer YOUR_AUTH_TOKEN',
                'Content-Type': 'application/json'
            }
        });

        console.log("=== Vision Test Response ===");
        console.log(JSON.stringify(response.data, null, 2));
    } catch (err) {
        console.error("Test Vision Error:", err.response ? err.response.data : err.message);
    }
}

testVision();

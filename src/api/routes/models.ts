export default {

    prefix: '/v1',

    get: {

        '/models': async () => {
            const capabilities = {
                "function_calling": true,
                "vision": true
            };
            return {
                "data": [
                    {
                        "id": "mimo-v2-flash",
                        "object": "model",
                        "owned_by": "xiaomi",
                        "capabilities": capabilities
                    },
                    {
                        "id": "mimo-v2-omni",
                        "object": "model",
                        "owned_by": "xiaomi",
                        "capabilities": capabilities
                    },
                    {
                        "id": "mimo-v2-pro",
                        "object": "model",
                        "owned_by": "xiaomi",
                        "capabilities": capabilities
                    },
                    {
                        "id": "mimo-v2.5",
                        "object": "model",
                        "owned_by": "xiaomi",
                        "capabilities": capabilities
                    },
                    {
                        "id": "mimo-v2.5-pro",
                        "object": "model",
                        "owned_by": "xiaomi",
                        "capabilities": capabilities
                    }
                ]
            };
        }

    }

}

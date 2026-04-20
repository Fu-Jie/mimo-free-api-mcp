import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import mimo from '@/api/controllers/mimo.ts';

export default {

    prefix: '/v1',

    post: {

        '/vision': async (request: Request) => {
            request.validate('body.query', v => typeof v === 'string' && v.length > 0);
            
            const { query, image, images } = request.body;
            const imageList = Array.isArray(images) ? images : (image ? [image] : []);
            
            if (imageList.length === 0) {
                throw new Error("No images provided for recognition");
            }

            const result = await mimo.performVision(query, imageList, request);
            
            return new Response(result, {
                type: "application/json"
            });
        }

    }

}

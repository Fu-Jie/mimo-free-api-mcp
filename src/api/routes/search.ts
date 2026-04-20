import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import mimo from '@/api/controllers/mimo.ts';

export default {

    prefix: '/v1',

    post: {

        '/search': async (request: Request) => {
            request.validate('body.query', v => typeof v === 'string' && v.length > 0);

            const { query } = request.body;
            const result = await mimo.performSearch(query, request);
            
            return new Response(result, {
                type: "application/json"
            });
        }

    }

}

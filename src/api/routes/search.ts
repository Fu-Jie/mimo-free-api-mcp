import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import mimo from '@/api/controllers/mimo.ts';

export default {

    prefix: '/v1',

    post: {

        '/search': async (request: Request) => {
            request.validate('body.query', v => typeof v === 'string' && v.length > 0);

            const { query, model, max_results, include_domains, exclude_domains } = request.body;
            const result = await mimo.performSearch(query, request, {
                model: typeof model === 'string' ? model : undefined,
                maxResults: typeof max_results === 'number' ? max_results : undefined,
                includeDomains: Array.isArray(include_domains) ? include_domains.filter((d: unknown): d is string => typeof d === 'string') : undefined,
                excludeDomains: Array.isArray(exclude_domains) ? exclude_domains.filter((d: unknown): d is string => typeof d === 'string') : undefined,
            });
            
            return new Response(result, {
                type: "application/json"
            });
        }

    }

}

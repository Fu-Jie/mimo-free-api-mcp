import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import mimo from '@/api/controllers/mimo.ts';

export default {

    prefix: '/v1/chat',

    post: {

        '/completions': async (request: Request) => {
            console.log("-> [Router Inbound] Request Received!");
            request
                .validate('body.conversation_id', v => _.isUndefined(v) || _.isString(v))
                .validate('body.chat_id', v => _.isUndefined(v) || _.isString(v))
                .validate('body.messages', _.isArray);

            let { model, conversation_id, chat_id, messages, stream } = request.body;
            const convId = conversation_id || chat_id;
            model = (model || "mimo-v2-omni").toLowerCase();

            if (stream) {
                const streamResponse = await mimo.createCompletionStream(model, messages, convId, request);
                return new Response(streamResponse, {
                    type: "text/event-stream"
                });
            } else {
                const jsonResponse = await mimo.createCompletion(model, messages, convId, request);
                return new Response(jsonResponse, {
                     type: "application/json"
                });
            }
        }

    }

}
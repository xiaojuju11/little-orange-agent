import { jsonSchema } from 'ai'

export const weatherTool = {
    description:'查询指定城市的天气信息',
    inputSchema:jsonSchema({
        type:'object',
        properties:{
            city:{
                type:'string',
                description:'要查询的城市名称,例如:"南昌","北京"',
            }
        },
        required:['city'],
        additionalProperties:false,
    }),
    execute:async ({city}:{city:string}) => {
        const mockWeather:Record<string,string> = {
            '南昌':'晴,30摄氏度,东南风2级',
            '北京':'雨,25摄氏度,西北风3级',
            '上海':'晴,28摄氏度,东南风2级',
        }
        return mockWeather[city] || `${city} 未找到该城市的天气信息`
    }
}

// {
//   "type": "function",
//   "function": {
//     "name": "get_weather",
//     "description": "查询指定城市的天气信息",
//     "parameters": {
//       "type": "object",
//       "properties": {
//         "city": { "type": "string", "description": "城市名称" }
//       },
//       "required": ["city"]
//     }
//   }
// }
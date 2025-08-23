from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig
import json

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'video_id parameter is required'}).encode('utf-8'))
            return

        try:
            # --- Using the SOCKS5 proxy from your screenshot ---
            # The format for SOCKS proxies is "socks4://IP_ADDRESS:PORT"
            proxy_url = "socks5://108.162.192.185:80"

            # The GenericProxyConfig needs both http and https URLs for SOCKS to work with the requests library
            proxy_config = GenericProxyConfig(
                http_url=proxy_url,
                https_url=proxy_url,
            )

            api = YouTubeTranscriptApi(proxy_config=proxy_config)
            
            transcript_list = api.fetch(video_id)
            
            full_transcript = " ".join([item['text'] for item in transcript_list])

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred: {str(e)}'}).encode('utf-8'))
            
        return

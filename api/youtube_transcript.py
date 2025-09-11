from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import time

# --- Selenium Imports ---
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        # --- 1. Parse the video_id from the request URL ---
        query_components = parse_qs(urlparse(self.path).query)
        video_id = query_components.get('video_id', [None])[0]

        if not video_id:
            self.send_response(400)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'video_id parameter is required'}).encode('utf-8'))
            return

        driver = None # Initialize driver to None for the finally block
        try:
            # --- 2. Set up and run the Selenium scraper ---
            
            # Configure Chrome to run in headless mode (no UI) which is essential for servers
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            
            driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)
            
            video_url = f"https://www.youtube.com/watch?v={video_id}"
            driver.get(video_url)

            wait = WebDriverWait(driver, 20)

            # Click the "...more" button in the description box
            more_button = wait.until(EC.element_to_be_clickable((By.ID, "expand")))
            more_button.click()
            time.sleep(1)

            # Locate and click the "Show transcript" button
            show_transcript_button_xpath = "//ytd-button-renderer[contains(., 'Show transcript')]"
            show_transcript_button = wait.until(
                EC.presence_of_element_located((By.XPATH, show_transcript_button_xpath))
            )
            driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", show_transcript_button)
            time.sleep(1.5)
            wait.until(EC.element_to_be_clickable((By.XPATH, show_transcript_button_xpath))).click()

            # Wait for transcript and extract text
            transcript_segment_selector = "ytd-transcript-segment-renderer yt-formatted-string"
            wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, transcript_segment_selector))
            )
            transcript_elements = driver.find_elements(By.CSS_SELECTOR, transcript_segment_selector)
            full_transcript = " ".join([elem.text.replace('\n', ' ') for elem in transcript_elements if elem.text])

            # --- 3. Send the successful JSON response ---
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'transcript': full_transcript}).encode('utf-8'))

        except Exception as e:
            # --- 4. Send an error response if anything fails ---
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'An error occurred during scraping: {str(e)}'}).encode('utf-8'))
        
        finally:
            # --- 5. Ensure the browser is always closed to prevent resource leaks ---
            if driver:
                driver.quit()
                
        return

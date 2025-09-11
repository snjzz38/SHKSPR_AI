import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import TimeoutException

# --- Configuration ---
VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# --- Main Script ---
print("Starting the definitive YouTube scraper...")

# Set up the Chrome driver automatically
try:
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    print("Chrome driver started successfully.")
except Exception as e:
    print(f"Error setting up Chrome driver: {e}")
    exit()

# Navigate to the YouTube video page
driver.get(VIDEO_URL)
print(f"Navigated to: {VIDEO_URL}")

# Use WebDriverWait for robustly waiting for elements
wait = WebDriverWait(driver, 20) # Increased wait time for more reliability

try:
    # STEP 1: Handle the Cookie Consent Pop-up
    print("Looking for the cookie consent pop-up...")
    try:
        # This XPath finds the button with the specific "Accept all" label.
        consent_button_xpath = '//button[@aria-label="Accept all"]'
        consent_button = WebDriverWait(driver, 7).until(
            EC.element_to_be_clickable((By.XPATH, consent_button_xpath))
        )
        print("Cookie consent pop-up found. Clicking 'Accept all'.")
        consent_button.click()
        time.sleep(1.5) # Give the page a moment to react after closing the pop-up
    except TimeoutException:
        print("Cookie consent pop-up not found, continuing...")

    # STEP 2: Click the "...more" button in the description box
    print("Waiting for the '...more' button to expand the description...")
    # The button to expand the description has the ID 'expand'
    more_button = wait.until(EC.element_to_be_clickable((By.ID, "expand")))
    more_button.click()
    print("Clicked the '...more' button.")
    time.sleep(1) # Wait for the description to finish its expanding animation

    # STEP 3: Scroll down and click the "Show transcript" button using its unique ID
    print("Waiting for the 'Show transcript' button...")
    
    # THIS IS THE KEY CHANGE: Using the button's unique ID for reliability.
    show_transcript_button_id = "show-transcript-button"
    show_transcript_button = wait.until(
        EC.presence_of_element_located((By.ID, show_transcript_button_id))
    )
    
    # Scroll the button into the center of the view to ensure it's clickable
    print("Scrolling to the 'Show transcript' button...")
    driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", show_transcript_button)
    time.sleep(1.5) # A pause to ensure scrolling and animations are finished
    
    # Now, wait for it to be clickable and click it
    wait.until(EC.element_to_be_clickable((By.ID, show_transcript_button_id))).click()
    print("Clicked the 'Show transcript' button.")

    # STEP 4: Wait for transcript and extract text
    print("Waiting for the transcript to load...")
    transcript_segment_selector = "ytd-transcript-segment-renderer yt-formatted-string"
    wait.until(
        EC.presence_of_all_elements_located((By.CSS_SELECTOR, transcript_segment_selector))
    )
    print("Transcript loaded. Extracting text...")

    transcript_elements = driver.find_elements(By.CSS_SELECTOR, transcript_segment_selector)
    full_transcript = "\n".join([elem.text for elem in transcript_elements if elem.text])

    # STEP 5: Print the final result
    print("\n--- FULL TRANSCRIPT ---")
    print(full_transcript)
    print("-------------------------\n")

except Exception as e:
    print(f"\nAn error occurred: {e}")
    print("Could not retrieve the transcript. If this still fails, the video may not have a transcript or YouTube's layout has fundamentally changed.")

finally:
    # STEP 6: Clean up
    print("Closing the browser.")
    driver.quit()

# 📚 AI Essay Grader
# Effortlessly grade essays with custom instructions, rubrics, and strictness levels, powered by advanced AI. This web application streamlines the evaluation process, providing detailed feedback and actionable improvement suggestions for students   and educators alike.

# ✨ Features
Intelligent Grading: Get a comprehensive grade and detailed feedback based on your specific criteria.

Customizable Rubrics: Define your own grading rubric to ensure the AI evaluates essays exactly how you intend.

Flexible Instructions: Provide detailed essay instructions to guide the AI's understanding of the assignment.

Adjustable Strictness: Control the AI's grading rigor with a simple slider (from lenient to strict).

Multimodal Input Support:

Upload essay instructions, rubrics, and essay content as text files (.txt, .md).

Upload content as PDFs, with automatic text extraction (note: images embedded in PDFs are not processed by the client-side, please upload images separately for AI to analyze visuals).

Upload content as standalone images (.jpg, .png, .gif, .webp) for the AI to visually read and grade.

Directly type content into text areas.

Extra AI Instructions: Add specific, ad-hoc guidance to the AI for a particular grading session.

Structured Feedback: Receive AI feedback formatted clearly with overall grade, detailed criterion-based evaluations, general comments, and actionable "What to Work On to Improve" sections.

User Authentication & Persistence: Uses Firebase to securely store grading results tied to your user ID, allowing you to revisit past evaluations.

# 🚀 How to Use
Clone the Repository:

git clone <repository_url>
cd ai-essay-grader

Open in Browser: Simply open the index.html file in your web browser.

open index.html # On macOS
start index.html # On Windows
# Or simply drag and drop index.html into your browser

Provide Inputs:

Fill in the "Essay Instructions," "Grading Rubric," and "Essay Text" fields. You can type directly or upload files.

For visual content like graphs: If your essay includes crucial visual elements, upload them as separate .jpg, .png, or other supported image files using the respective file input.

Adjust the "Grading Strictness" slider to your preference.

Add any "Extra AI Instructions" for more nuanced grading.

Grade Essay: Click the "Grade Essay" button and wait for the AI's detailed feedback!

# 🛠️ Technologies Used
HTML5 & CSS3: For the core structure and styling.

Tailwind CSS: A utility-first CSS framework for rapid and responsive UI development.

JavaScript (ES6+): Powers the interactive elements and AI integration.

PDF.js: Mozilla's PDF library for client-side text extraction from PDF documents.

Marked.js: A markdown parser for rendering the AI's structured feedback beautifully.

Firebase (Authentication & Firestore): For secure user authentication and persistent storage of grading results.

Groq API: The powerful multimodal AI model used for essay grading and feedback generation.

🤝 Contributing
Contributions are welcome! If you have suggestions for improvements or new features, feel free to open an issue or submit a pull request.

📄 License
This project is open-source and available under the MIT License.

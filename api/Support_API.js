// In /api/Support_API.js
import { Resend } from 'resend';

// Initialize Resend with your API key from Vercel Environment Variables
const resend = new Resend(process.env.SUPPORT_1);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Destructure the body from the frontend request
    const { category, otherSubject, message } = req.body;

    // Determine the final subject line
    const subject = category === 'Other' ? `Support: Other - ${otherSubject}` : `Support: ${category}`;

    // Send the email using Resend
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev', // IMPORTANT: Replace with your verified email
      to: ['john.h.smith203@gmail.com'],
      subject: subject,
      html: `
        <h1>New Support Request</h1>
        <p><strong>Category:</strong> ${category}</p>
        ${otherSubject ? `<p><strong>Specified Subject:</strong> ${otherSubject}</p>` : ''}
        <hr>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });

    // Handle errors from Resend
    if (error) {
      console.error('Resend API Error:', error);
      return res.status(400).json({ error: 'Failed to send message via Resend.' });
    }

    // Send a success response
    res.status(200).json({ success: true, message: 'Message sent successfully!' });

  } catch (error) {
    // Handle any other server errors
    console.error('Server Error:', error);
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
}

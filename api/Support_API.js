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
    const { category, otherSubject, message } = req.body;

    // Determine the final subject line
    const subject = category === 'Other' ? `Support: Other - ${otherSubject}` : `Support: ${category}`;

    // Send the email
    const { data, error } = await resend.emails.send({
      from: 'SHKSPR Support <onboarding@resend.dev>', // This must be a verified domain in Resend
      to: ['john.h.smith203@gmail.com'], // Your email address
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

    if (error) {
      console.error('Resend API Error:', error);
      return res.status(400).json({ error: 'Failed to send message.' });
    }

    res.status(200).json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: 'An internal server error occurred.' });
  }
}

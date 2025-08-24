supportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    const category = subjectSelect.value;
    const otherSubject = document.getElementById('other-subject-text').value;
    const message = document.getElementById('support-message').value;

    const formData = {
        category: category,
        otherSubject: category === 'Other' ? otherSubject : '',
        message: message
    };
    
    try {
        // CORRECTED: Use the absolute path for the Vercel API endpoint
        const response = await fetch('/api/support', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        if (response.ok) {
            alert('Thank you for your message! We will get back to you shortly.');
            supportForm.reset();
            otherSubjectContainer.style.display = 'none';
            supportDropdownPanel.classList.remove('visible');
        } else {
            const errorData = await response.json();
            alert(`Error: ${errorData.error || 'Could not send message.'}`);
        }
    } catch (error) {
        console.error('Failed to send support message:', error);
        alert('Failed to send message. Please check your network connection.');
    }
});

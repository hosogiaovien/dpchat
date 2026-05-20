async function testFetch() {
  const url = "https://script.google.com/macros/s/AKfycbzW9dsfvgk5cetelhA_O8_6frO7bXpyP0coBNFp-AgndKasleXJJT2NHCE_IJs8GBqR/exec";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      redirect: "follow",
      body: JSON.stringify({
        base64: "dGVzdA==", // "test"
        mimeType: "text/plain",
        fileName: "test.txt"
      })
    });
    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Response text:", text.substring(0, 500));
  } catch (e) {
    console.error("Fetch error:", e);
  }
}
testFetch();

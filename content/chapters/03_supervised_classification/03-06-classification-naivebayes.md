---
title: "Chapter 03.06: Naive Bayes"
weight: 3006
quizdown: true
layout: lecture
lecture_id: i2ml-03-06
fallback_video_url: https://www.youtube.com/watch?v=TJ0ZSAyIi_c
fallback_pdf_url: /pilot-assets/pdfs/10961d07ae7b2ede2b84d05d3544321ee1eab672d9dead4106b31918c14c67ff.pdf
---
Naive Bayes is a generative approach based on an assumption of conditional independence across features and closely related to discriminant analysis.

<!--more-->

### Lecture video 

{{< video id="TJ0ZSAyIi_c" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/blob/master/slides-pdf/slides-classification-naivebayes.pdf" >}}

<!-- modern-lecture:supplements -->

### Code demo

**Comparison of classification methods**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_cmpclass.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_cmpclass.pdf" >}}

### Code demo

**Deep-dive generative classification methods**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_genclass.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_genclass.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] Naive Bayes assumes that the features are independent within each outcome class $y$.
- [x] Naive Bayes follows a generative approach.
- [ ] Decision boundaries in Naive Bayes are linear. 

{{< /quizdown >}}

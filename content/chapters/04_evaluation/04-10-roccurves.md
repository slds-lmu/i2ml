---
title: "Chapter 04.10: ROC Curves"
weight: 4010
quizdown: true
---
In this section, we explain the ROC curve and how to calculate it. In addition, we will present the AUC as a global performance measure that integrates over all possible thresholds.

<!--more-->

### Lecture video

{{< video id="91PXeV65x5Y" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/blob/master/slides-pdf/slides-evaluation-roccurves.pdf" >}}

### Code demo

**ROC**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_roc.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_roc.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [ ] If the proportion of positive to negative instances in the training data changes, the ROC curve will not change.
- [x] If the proportion of positive to negative instances in the test data changes, the ROC curve will not change.
- [x] Several evaluation metrics can be derived from a confusion matrix.
- [x] The area under the ROC curve is called AUC.
- [ ] A model with AUC=0 is the worst case.

## Which statements are true? 

- [ ] Using the prediction on the train data is the ordinary and correct way of calculating the ROC.
- [x] The calculation of the ROC should be done on a test set.
- [x] The AUC is not affected by the threshold, as opposed to the MCE.

{{< /quizdown >}}

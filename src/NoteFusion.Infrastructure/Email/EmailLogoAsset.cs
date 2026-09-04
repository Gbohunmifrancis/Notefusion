namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Pre-cached bytes of the optimized 5.2KB email logo (white mark for blue gradient header).
/// Serves direct GET /email/logo.png from the API with zero file I/O or external network latency.
/// </summary>
public static class EmailLogoAsset
{
    private const string Base64Png =
        "iVBORw0KGgoAAAANSUhEUgAAAFwAAAB6CAYAAAAyGjRzAAAUWElEQVR42u1dCZBcZRGeNzObQDCEGEJM" +
        "IAqJCkIKJITIEY0KiBwqhEsURcXyRkq5xMQ7oAiICop4iwqIiAkghwoUXiinB2gJCkJACZAIbLK7M++9" +
        "afe3vp9q2/6PN9fObJKqV7O7mZ1973v9+u/++uv+S0RU2gCPMhFV8Wq/34aIDiaiZUR0GRH9iYjWE1GO" +
        "IyOiB4joc0S0LRElOAr97Q0FYANMBV8boHceBe9YIjqHiK4nogcB6AhANq91Ikrxcwu4+dkwjq8T0VZF" +
        "QR/PAHML3pyIDiWii4hoFYA0wA4RUU2AmjuOhniPuSkPE9HcDRXwRAC83yhIHyWiXwLcYYCUMuAyBqAB" +
        "lP9rBI4Un3cbEW2yoQBeZiBvSkRvIKIVRDQIgIcUgHMFPHJ87TtyfLZ5Qt4X61r61ZLtsQMRvRcgPwaQ" +
        "aw6AfZYbCzgJwO3n38XWiHEDuLXmXUf983Ii+itbxFIBQMg6Y0B1vXLAc/zcnMfi8QK4DeGWwF9KkPMAME" +
        "VdRSPy8/hhbvTJ/Q64cRkTRqOK40Z9870Auc4sueFwFS6gmgU81p+f26+A28VnH4Rww8IfkwCVf58XBL" +
        "XoDXDdRHNuZ/Uj4AlCuvOIaJ0jstDAJeFXYxZFUoAkD7Dk+KwcC/Xb+hHw5yKlrgmLbiiAaP47b9Efh1" +
        "yT/NvWvT1NRDP7DfCJRPQ7lk43PJZW1KLJY61UMCy0INdwmPO9pt8SHxOJfFdEHnkTCxq1cVHMxU21QN" +
        "tkZ4jxLvv3G+D740KKAKE93jbdHmapfI0d/P9q7G82lITGkld19rsjAHoIa8wgmMWknwBPcNJZxOIlAb" +
        "cL1jD7+SPgTy4movOJ6PTRLPBToy7r00T0JSK6nIjuJKJ/s0V5hPEs8qZxgJ+Cv16Pw5z31H4jrzYjoic" +
        "jHnlipJFNfsz3f0EMbNjAGYLIKgsqgP/MvG43mpa/DiTXT3CzhmC5gwD3KRxPgj4wr38YzXSP7lc+fC9" +
        "HiEeKRafMd/6QiPYWLGEra4j9nHlE9C4i+gYW8QfAl5ss9wKk8E0VH3oF8EMVwLVkxnLYxi3s2AaQY26C" +
        "KyFr+ugFwA9zJDcy9HscxFXSz5RyL5zEkkAsbaOG13TBqjcIwA8LxNw5FsmZ46Ey1QsncTjLLF3AG8Cn" +
        "bwS8sy6lIaKTjYB3KEpx8RdbbQS8fYBnjpohB/w5GwFvb1joSuUt4LMUSYQ9Kjh4JrkR8CaiFE5QzWa/" +
        "U0VabjLNlxPRIiJaAFHONCV87Jmb0EuAa+6Ef//uUbfyFSL6BRGtYQzeEFNRWXbQcB93Qz5hyKujUNwo" +
        "tYkKGNdxuD1qgvTn/HSqcOmZYP5MaPn70a9PZetB0m3L75U4PFQay4TuL1Z/woHnfPkgRJymDrlFN4Hv" +
        "BcCPUsAjsWDmgSjGVeckj1rK8uBPgy+f1A1300uA555quovU0qKZRkDeRkIbaKmDv49a/omdtvheAPxI" +
        "IeyJFfPkgRtRRK+SscLwvyDK36IToPcq4I0mgC0COHn8vXU1Ru21fbutvRcAPyIASN6ETK3ozZFfW+AN" +
        "B38K9N/JeLLw3KMbkSl+nYV6I+KQFfk8oFEJ3SRr7T8josnjpeJzRAQfbilaC7bxs7cS0ZVEdCkRfY+I" +
        "foCk6D4kQRywmuBrfIs0Kf49xee+olXQez0O54cp5J5ERC9Aal9hr/IwId4uRPTm0Qzzm/jdnIHvCx9d" +
        "7ixHRvuWVkDvJcDzgPpp+9guA6V7rQK+5RKAZp8UVxjqcnH2iflQP1ftlwSiFAvA1k1eZCLAnw1+ZTXTu" +
        "PgUuFriVIOWJenHtsElwr+6QrZZbZZATEDvZcaE/i7hqLR8+zvLxiPg1AHALUjG4ncnomuFtTcctIAMI4" +
        "2ln9Bv2sLDlBYSjQ/vZMXHLL5nMnfhaqKS55UhDF3Qj4smeUSbWRdqmsbNHEREfxMuxsfPWGO4J7YNvN" +
        "fYQhdXknaxiGwEoT9moPtkeNwg7gL/EgR8rNVMR0fE4d2WSRjf/mUROpKHHraJ2bkhPEvwjWNZ73t9BF" +
        "+SMSlyt44BIvqOI15vKB11OTTk+4cA3waLxliJ8Q/39PTEAt4p/tr0Hd3AOiXyCDLsURSynYBv3QXArZ" +
        "QhEYXcBIL4mMTnOZ4JElUhvm+nQTyLiG4WfExIJfYZl2vpFOB2XokFYFuoX49HOcv0YX4fpNM1gbDQAm" +
        "6JOadgQo8RzT+EgTObd+BaZmBRrEf686dARaiAz2oj4FyMYyY9nIEwS1KpdZat1SIWTQ3whEUTfGjM1U" +
        "1wLjGgz4K7aERwL+Z8vuUCfGYk4IlHUGPdxXS0a9wCirTukDPICnzMqAzpUp7Phhxw9e0IOiQ6sd4c53" +
        "gatbDW9AK90BWlVCP9cFn4JnsTzBCCD+OP1BjAmYcIahToHtYA34VlhXzRNTd5YQfDxTscxQ15fRminC" +
        "jAN8FKu7ngHSrMyu33dtpDXWhAQsMBcgcvrd2MTAF8V5Gc8F6gl3QwqtqPGVWoi3k9+Pv/AXyGADwB2N" +
        "NxTGKAVxnpPw8hUy3gGnwt27knZZaAz3QA3ugi4PZJP0M01bpItwwLeRIC3II9TQF8AGWxdcxtUMHW7D" +
        "xwU4oALktmnXQp9jCY/DMi5SeMIJnEAZ+urOpbAuypbGJZFYXUs/GoZBFCeoqUo4VaBn0uhRQaYPcu5BX" +
        "LPZUheT6HWyu34Eof/myAPQXZlp3Oc7GIChpKmksR86MaTVi4D3DqMuAliKXroEFBCr7dC/gWOCzgE0Dm" +
        "aC6EImRlobEaeeB9WpQyXwHcZnoLu0RwfVuhJbSFf9AWUEpwHS7ArZVfJjhiipyWU3QojMvaNcB3U+qR" +
        "jQjAK21kSOcgF/BFK9YI3m6s3LqPigNwc3xRZHOxgIf8OjlGcGhPzaMYgiAB10Z+1B1RCu+nbxfo5vN+" +
        "hEE85vWrFvCpCuDWh79TjMZoFJyg0wjIh0lM2cmV95ifX6VkuLs55p1oYWGCdpSvoTpjBESvbAPRlUAK" +
        "FxM8mAkUZWvNFfEhBvCXKWDHWDU5tHp1waXIwS9a5dy+b0mLgE/AjBROAQwhW23VykcK2tZlVObvTbOM" +
        "mwTcWPdvI3iO0CAuC6p9fQAjMa7Hyn0zhoqtYdkbbyupgQ3UqIcFosruAjzBDRsWwNThLlslujbBsJtQ" +
        "EmTOa7EGuPFt72A8RawIklt1jckO7sVjNwcDeQdYxjoA65uCOYVfwIjTB8H67eMBZIEia3BZ+Ck4JxIV" +
        "95U4h1Zj8psC4aEF/J0W8Cqzhi3QDZAHhPDckvnFprDYr2KYyyTGi1ccB59Uvwl+ZyBQUNjd41L2UACv" +
        "K6HoCtzwVv34OWIB1/SK/03zpYVXAFQaGbpJdWuK5Gg2o2wrBRanpEBz60KRaVIE4JI4cwHOK1TViHM5" +
        "xoGZ9Awr7HBz+6E7M1/n89O54qufhlp1Qpe6wnwWvqd476mC6HoGAAVwe9MPHHVtb43UNO6l1Ds1w7zT" +
        "Am4f7bMVepUCbR3m/f9AVFPuQLUlBDhFAP4hB+ArFcANwDeyxfsJWHA5kObXI4oo95ZASFlN9aoC3QE2" +
        "dn4QXb7dbq/e3bNoxgJ+pQL451k4akPZx7Dg+ybTDQbcrjlWWcCNS3mjwvFqFk6s5e4p+NJug50IwCmwa" +
        "J7mUFJpgN/i6PdZ7LnGCp4Enws2r4+WIAOYhMQgj2T0rIjxmC66kHYBzgHQAL/DMT7kVR7Aq3jSfYUU8" +
        "2+NBXy+Q5jusnbz3gsLRiDtBnyhh57d0wG4NCDNh9/pYCv39VzrAHPHLpmH+bfWVi9O8rCB2vEA0v+x1" +
        "CW6Fs06ogYX4PzfSoeFk/JE7xOw8NURQcYTlme4ImDRMn794Bi5EplppsqFpZij4lo0+fu1sPA2BbQsQH" +
        "ZNwHoWqlyttvq5B5WeSFdT0WMoWoy1zHk3BfBGAHD5TwP8VkcHhs/Cp4GcCnH9q6y+I/XcHRIh1/t7ZGD" +
        "jAsWl2PXFB3gjYOG3K9y8+frVHsDnBSZi2K/vLmETuDyCciU8NtN6ZAS2BDz3WPhpjoLzysgopYHuCBfg" +
        "+wYqXvbrG0ugP9PInZxu6pDStsxkGLEqWF9qv0i898OOEHKlw8I1DA70nNPxDsm1xPSbJdCgWQQVm6G/s" +
        "ULtVdhyuTEvf1UDrkuLw8kB+DKFvPIBrgULB3l0lRcG5nbZhXe5fYTyiG1VstitUwpY9AwQXhfgxl+LL" +
        "RjfD7nvhAg+XJ675lKWKSqtXAHcAPojcXNSJHlzPNdyR+RMlmNLqPHF1icXtwlsY70HQL3E91lIRfvGl0" +
        "A9lB1RiqYL0QBfqiQ+LsAPFnLqYWjZXe5kKmNYc0+Wac5rQQnj5mIAz7Eat+pGTIHhY0zOnDLQM7FtYoY" +
        "y3DRHTbMWaeFLldQ+d6T2ZWwTeRPcy+meQCFB9JIrwxCkpzD09VTzS3+M3KEpLbo7qsPffVYRFGlVe2I" +
        "1zhvAyCVKASJTAF8k3rtUUdpaC5/oGIgwIaLqVMHGHiElWQ7D+W/V/jcBvTZvi5sb0dCUeF7ns73VYpRX" +
        "fObJR5g/L4OgcvnwRWKzjWUOC18hdnuVgxAGmDtLlOs2/3+/R5zPDedMC/jlHgWs/KV5LbqTGyM3RdJkz" +
        "Y+zXs0EfEnqKIgsEn/3BKX9r45ZKtUWruc1EdpCm4wdYoVA5zjiWc35v7IFwGcLeXEjcisCvkno4aKsJe" +
        "XKmg+3/TlrlU2UjmyB7ayCO4+R9a2zndQlbHGbRfAAGZRYzQL+WgfQoR1ZeXj2SfaI7ymyR55p7uVowL" +
        "0fv/NPJEOtWPdLA0JOrvxdYc/bLj5ZBAAZ2v0GmjzB90YUWinQjnIB8+M+wPdwLHCTEE9PbaFKZf37VY6" +
        "xI/Ia6pgA/Qzgk+EfG4G+8hxMWrXJk3xPAHCK2CvzPAb43gp5lXs6IBIxKytpIY/Y2xEhadOD7uZGypVD" +
        "oe4Fq8eb6zlZ30Uc4NDgxY61q4OHt5HHHsrwATvMd4cOkmaT0SSbBQzHDrA5Tfb4lBEbx06v/ESTfMp0g" +
        "BEjYNdohZrobJgMn8wXwmFoFwc6BLi57g84ggyt1XE9urD/b17KwYJr8Fnev1Bea+ZR/LaYuBNr5ebcfi" +
        "qATNB2cjPrdL5aTNJv25ZeOP8Z0KrnEVPgUvRpJhrgUwBkHiGoz0EuVRzJT6IkPfbrLcHd1B2JQq5cTMq" +
        "0L4myeA3Aiubg64o4j2YOeV2W/7nc4Q61QTZPIBxVAbeqq7oHZP7I3N3kwpNgwRlSOpW1sad2vOlBgfSa" +
        "D4zshN+uYt/6ekRgYRfLL2qkG//Q7di+lhTIPOvI3ipNPLJVJFD3KtsMcD15Dit5k0OOkRRwGa4nMPZ8D" +
        "2SUhK8PyXZiD2LhTnwzryqsek8Oy+YRg2G/dmrSyqvIvM4HqDWxpa6VO88a4x1KDCbPg7tNHWJWmauMoL" +
        "XFOS+F+65DPFmnlCKMgMWbpHx4EvFqKzrTURM8BvXVfXAzqqLqkzisPPFYv2s9Ca019vzmYkfaNLKZ12r" +
        "jt3etDfIPT0BMnnn64HMx3Hw5fs/HqrkutMwWukRh6RIPuEnAvTTz5PFzeD66MdLA4AWOzwgohLKLTdX+6" +
        "Hw2DjoP8AQN1oNY6ffNRZllz0A0VQuEyblQfF0awkF7/AZAW9Y96isZb67H/MGKw72EFrikgDW3YwSqqx" +
        "hcASl1n2hxJ89MFHusxkCasv/FuS58Wybd8rV080V0HSTP1R6QwTWzOFbR7fakaEoI8TsZDO6AGIGU626" +
        "XUaGoO+hSckjMalA5Sb+cBHx60cwwxvKTiKfFqgeeBXpjxFHU8G1VYzD6tBiqljQzCnUqYuUsgt3jKXgd" +
        "RY1NlZFNpR7x87yjbiYqUamizqLAXKsUEomJsddVCkhwje7wETHjKbRTiD3xm6EdGVBmFo61+6iA/DoeMX" +
        "Zd8dd54DozYDOviAuNIWxejk7b1LOAaqu3XUwvQndcpUX/nrRBC2MHtZ8MjXvqKES7AOdde/dgkSx0PaUI" +
        "31phrdNZxO5PkgLIkJV+BE23Ayz+Lhfs4SwSuUgp3WaIpO4ROphGBJ0hw+DHMKqvGrGO/M/6VcTfnShW7" +
        "zxyuk/OuBLTlnEWeG3u46ttkEDL0Rx2vJ8RDH0cPf0caN/utLmjXGZ+789F3Ugz88PtCKYLmVoqZiGVxd" +
        "Qak5DdDmJqS9Z/z6nQqqdVXE6Y4783AL7eVPivY0WPmqM9OxSR8Jb2h5HuNx32FvWDm0HevE5pw4spKHA" +
        "faC1tLXaCOgOzxF8EadlEpn6qisMORZiI9+6ESXNnYFLFasbc1SKGgfk4eftU/AFBREtPYqlJvuEILKR1T" +
        "/QSM+UtE3Sstf61GLBwF27GFUibL0ER4Ho8Ifez80jFPNssMCwnZsqcVc6ejVi95YSumSjB+sn5aPnOHNX" +
        "zmFH+mqS3zjjyumOt0N6XFrRkn3XbdH0Nyo/VAvN5m058YhaoOYxdTBXtHkVYf2gvNG3Xqjxylou2k2xo+" +
        "xp7836NcLbczp6mdmzHshmigEEF+FgwKXJUCEUu1I3A7lMu95FhfVreLhfiK7G1AnoZ8rLrQO1mSkRQZJ" +
        "5ho8BoVd9+yD7SKWcJmiWgVkDvUmlB8FTYwhNP1SR2k7mbRBdB3uRsQypwE/JIF9MQ0cswFuXd2qDK6vrGS" +
        "WUmZn8tQqka841ZAUAbET43Vu7M6QYb5q2HIH8h43s63n/aya22KvDvB0AQs1bssp1GNHIV8dENx4iRmvi" +
        "790E9tqNIpLpCnnWSNOLiyTIUUUtRJxxhXHsqEqGYcFLb9z5XPsvqwAexucchWAzLQjRU6iXA2+VqLFm1K" +
        "SRqJ2DTjIfweNeU0DIVR128piJ2tmqCx9FK83m4tq3ZzR8YS4rYV0/0yQmSJp8AWZWvoMdmLrrBjITuK8" +
        "gmf4WnYRXYuTVwS2vw/SoowK7B9jTLUTF/MRsNyIfMl5uoPJUKyDBiAo7kP4ZT0I9VzYWhAAAAAElFTkSu" +
        "QmCC";

    private static readonly Lazy<byte[]> PreloadedBytes = new(() => Convert.FromBase64String(Base64Png));

    public static byte[] Bytes => PreloadedBytes.Value;
}
